import { Construct } from "constructs";
import { Effect, ManagedPolicy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  ChainDefinitionBody,
  Fail,
  Pass,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { Arn, ArnFormat, Duration, Stack } from "aws-cdk-lib";
import { ICluster } from "aws-cdk-lib/aws-ecs";
import { CanWriteLambdaStepConstruct } from "./can-write-lambda-step-construct";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { DistributedMapStepConstruct } from "./distributed-map-step-construct";
import { FargateRunTaskConstruct } from "./fargate-run-task-construct";
import { ThawObjectsLambdaStepConstruct } from "./thaw-objects-lambda-step-construct";

export type CopyOutStateMachineProps = {
  vpc: IVpc;

  vpcSubnetSelection: SubnetType;

  fargateCluster: ICluster;

  /**
   * Whether the stack should use duration/timeouts that are more suited
   * to demonstration/development. i.e. minutes rather than hours for wait times,
   * hours rather than days for copy time-outs.
   */
  aggressiveTimes?: boolean;

  allowWriteToThisAccount?: boolean;

  // WIP workingBucket workingPrefix
  // should make it that if specified this is a bucket that exclusively
  // holds the source CSVs and result CSVs (so we can lock down the S3 perms)
};

export class CopyOutStateMachineConstruct extends Construct {
  private readonly _stateMachine: StateMachine;
  constructor(scope: Construct, id: string, props: CopyOutStateMachineProps) {
    super(scope, id);

    const canWriteLambdaStep = new CanWriteLambdaStepConstruct(
      this,
      "CanWrite",
      {
        vpc: props.vpc,
        vpcSubnetSelection: props.vpcSubnetSelection,
        requiredRegion: Stack.of(this).region,
        allowWriteToThisAccount: props.allowWriteToThisAccount,
      },
    );

    const thawObjectsLambdaStep = new ThawObjectsLambdaStepConstruct(
      this,
      "ThawObjects",
      {
        vpc: props.vpc,
        vpcSubnetSelection: props.vpcSubnetSelection,
      },
    );

    thawObjectsLambdaStep.invocableLambda.addRetry({
      errors: ["IsThawingError"],
      interval: Duration.minutes(1),
      backoffRate: 1,
      maxAttempts: 15,
    });

    const rcloneRunTask = new FargateRunTaskConstruct(
      this,
      "RcloneFargateTask",
      {
        fargateCluster: props.fargateCluster,
        vpcSubnetSelection: props.vpcSubnetSelection,
      },
    ).ecsRunTask;

    // our task is an idempotent copy operation so we can retry if we happen to get killed
    // (possible given we are using Spot fargate)
    rcloneRunTask.addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 3,
    });

    const distributedStepsChain =
      thawObjectsLambdaStep.invocableLambda.next(rcloneRunTask);

    const distributedMapStep = new DistributedMapStepConstruct(
      this,
      "MapStep",
      {
        task: distributedStepsChain, //rcloneRunTask,
      },
    ).distributedMapStep;

    const canWriteStep = canWriteLambdaStep.invocableLambda;

    const waitStep = new Wait(this, "Wait X Minutes", {
      time: WaitTime.duration(
        props.aggressiveTimes ? Duration.seconds(30) : Duration.minutes(10),
      ),
    });

    const defineDefaults = new Pass(this, "Define Defaults", {
      parameters: {
        maxItemsPerBatch: 1,
        requiredRegion: Stack.of(this).region,
        destinationKey: "",
      },
      resultPath: "$.inputDefaults",
    });

    const success = new Succeed(this, "Succeed");

    const fail = new Fail(this, "Fail Wrong Bucket Region");

    const applyDefaults = new Pass(this, "Apply Defaults", {
      // merge default parameters into whatever the user has sent us
      resultPath: "$.withDefaults",
      outputPath: "$.withDefaults.args",
      parameters: {
        "args.$":
          "States.JsonMerge($.inputDefaults, $$.Execution.Input, false)",
      },
    });

    canWriteStep.addCatch(waitStep.next(canWriteStep), {
      errors: ["AccessDeniedError"],
    });

    canWriteStep.addCatch(fail, { errors: ["WrongRegionError"] });

    const definition = ChainDefinitionBody.fromChainable(
      defineDefaults
        .next(applyDefaults)
        .next(canWriteStep)
        .next(distributedMapStep)
        .next(success),
    );

    // NOTE: we use a technique here to allow optional input parameters to the state machine
    // by defining defaults and then JsonMerging them with the actual input params
    this._stateMachine = new StateMachine(this, "StateMachine", {
      // we give people a window of time in which to create the destination bucket - so this
      // could run a long time
      timeout: props.aggressiveTimes ? Duration.hours(24) : Duration.days(30),
      definitionBody: definition,
    });

    // this is needed to support distributed map - once there is a native CDK for this I presume this goes
    this._stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [
          Arn.format(
            {
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
              service: "states",
              resource: "stateMachine",
              resourceName: "*",
            },
            Stack.of(this),
          ),
        ],
      }),
    );

    // this is needed to support distributed map - once there is a native CDK for this I presume this goes
    this._stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: [
          Arn.format(
            {
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
              service: "states",
              resource: "execution",
              resourceName: "*" + "/*",
            },
            Stack.of(this),
          ),
        ],
      }),
    );

    // this is too broad - but once the CFN native Distributed Map is created - it will handle this for us
    // (I think it isn't doing it because of our DummyMap)
    this._stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: ["*"],
      }),
    );

    this._stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecs:*", "iam:PassRole"],
        resources: ["*"],
      }),
    );

    // TODO tighten this
    this._stateMachine.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"),
    );

    // i.e perms needed for result writing from distributed map (from AWS docs)
    // https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultwriter.html#resultwriter-iam-policies
    // {
    //     "Version": "2012-10-17",
    //     "Statement": [
    //         {
    //             "Effect": "Allow",
    //             "Action": [
    //                 "s3:PutObject",
    //                 "s3:GetObject",
    //                 "s3:ListMultipartUploadParts",
    //                 "s3:AbortMultipartUpload"
    //             ],
    //             "Resource": [
    //                 "arn:aws:s3:::resultBucket/csvJobs/*"
    //             ]
    //         }
    //     ]
    // }

    this._stateMachine.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("CloudWatchEventsFullAccess"),
    );
  }

  public get stateMachine() {
    return this._stateMachine;
  }
}
