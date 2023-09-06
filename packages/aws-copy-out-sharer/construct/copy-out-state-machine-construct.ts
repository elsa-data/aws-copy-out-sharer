import { Construct } from "constructs";
import { Effect, ManagedPolicy, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  Fail,
  Pass,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { Arn, ArnFormat, Duration, Stack } from "aws-cdk-lib";
import { ICluster } from "aws-cdk-lib/aws-ecs";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { CanWriteLambdaStepConstruct } from "./can-write-lambda-step-construct";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { DistributedMapStepConstruct } from "./distributed-map-step-construct";
import { FargateRunTaskConstruct } from "./fargate-run-task-construct";

export type CopyOutStateMachineProps = {
  vpc: IVpc;

  vpcSubnetSelection: SubnetType;

  fargateCluster: ICluster;

  namespaceService: Service;

  /**
   * Whether the stack should use duration/timeouts that are more suited
   * to demonstration/development. i.e. minutes rather than hours for wait times,
   * hours rather than days for copy time outs.
   */
  aggressiveTimes?: boolean;
};

export class CopyOutStateMachineConstruct extends Construct {
  private readonly stateMachine: StateMachine;
  constructor(scope: Construct, id: string, props: CopyOutStateMachineProps) {
    super(scope, id);

    const canWriteLambdaStep = new CanWriteLambdaStepConstruct(
      this,
      "CanWrite",
      {
        vpc: props.vpc,
        vpcSubnetSelection: props.vpcSubnetSelection,
        requiredRegion: Stack.of(this).region,
      }
    );

    const rcloneRunTask = new FargateRunTaskConstruct(
      this,
      "RcloneFargateTask",
      {
        fargateCluster: props.fargateCluster,
        vpcSubnetSelection: props.vpcSubnetSelection,
      }
    ).ecsRunTask;

    // our task is an idempotent copy operation so we can retry if we happen to get killed
    // (possible given we are using Spot fargate)
    rcloneRunTask.addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 3,
    });

    const distributedMapStep = new DistributedMapStepConstruct(
      this,
      "MapStep",
      {
        task: rcloneRunTask,
      }
    ).distributedMapStep;

    const canWriteStep = canWriteLambdaStep.invocableLambda;

    const waitStep = new Wait(this, "Wait X Minutes", {
      time: WaitTime.duration(
        props.aggressiveTimes ? Duration.seconds(30) : Duration.minutes(10)
      ),
    });

    const defineDefaults = new Pass(this, "Define Defaults", {
      parameters: {
        maxItemsPerBatch: 1,
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

    const definition = defineDefaults
      .next(applyDefaults)
      .next(canWriteStep)
      .next(distributedMapStep)
      .next(success);

    // NOTE: we use a technique here to allow optional input parameters to the state machine
    // by defining defaults and then JsonMerging them with the actual input params
    this.stateMachine = new StateMachine(this, "StateMachine", {
      // we give people a window of time in which to create the destination bucket - so this
      // could run a long time
      timeout: props.aggressiveTimes ? Duration.hours(24) : Duration.days(30),
      definition: definition,
    });

    // this is needed to support distributed map - once there is a native CDK for this I presume this goes
    this.stateMachine.addToRolePolicy(
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
            Stack.of(this)
          ),
        ],
      })
    );

    // this is needed to support distributed map - once there is a native CDK for this I presume this goes
    this.stateMachine.addToRolePolicy(
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
            Stack.of(this)
          ),
        ],
      })
    );

    // this is too broad - but once the CFN native Distributed Map is created - it will handle this for us
    // (I think it isn't doing it because of our DummyMap)
    this.stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: ["*"],
      })
    );

    this.stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ecs:*", "iam:PassRole"],
        resources: ["*"],
      })
    );

    // TODO tighten this
    this.stateMachine.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );

    this.stateMachine.role.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("CloudWatchEventsFullAccess")
    );

    props.namespaceService.registerNonIpInstance("StateMachine", {
      customAttributes: {
        stateMachineArn: this.stateMachine.stateMachineArn,
      },
    });
  }
}
