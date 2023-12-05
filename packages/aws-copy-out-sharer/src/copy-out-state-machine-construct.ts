import { Construct } from "constructs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  ChainDefinitionBody,
  Fail,
  Pass,
  StateMachine,
  Succeed,
  Wait,
  WaitTime,
} from "aws-cdk-lib/aws-stepfunctions";
import { Duration, Stack } from "aws-cdk-lib";
import { CanWriteLambdaStepConstruct } from "./can-write-lambda-step-construct";
import { ThawObjectsMapConstruct } from "./thaw-objects-map-construct";
import { CopyOutStateMachineInput } from "./copy-out-state-machine-input";
import { RcloneMapConstruct } from "./rclone-map-construct";
import { CopyOutStateMachineProps } from "./copy-out-state-machine-props";
import { SummariseCopyLambdaStepConstruct } from "./summarise-copy-lambda-step-construct";

export { CopyOutStateMachineProps } from "./copy-out-state-machine-props";
export { SubnetType } from "aws-cdk-lib/aws-ec2";

/**
 * A construct that makes a state machine for bulk copying (large)
 * objects from one bucket to another.
 */
export class CopyOutStateMachineConstruct extends Construct {
  private readonly _stateMachine: StateMachine;
  constructor(scope: Construct, id: string, props: CopyOutStateMachineProps) {
    super(scope, id);

    if (props.workingBucketPrefixKey)
      if (!props.workingBucketPrefixKey.endsWith("/"))
        throw new Error(
          "If specified, the working bucket prefix key must end with a slash",
        );

    // these are the default values that are applied to the *steps* input
    const defaults: Partial<CopyOutStateMachineInput> = {
      maxItemsPerBatch: 8,
      copyConcurrency: 80,
      requiredRegion: Stack.of(this).region,
      // by default we just copy into the top level of the destination bucket
      destinationPrefixKey: "",

      // these are the default objects that will be created in the destination prefix area
      destinationStartCopyRelativeKey: "STARTED_COPY.txt",
      destinationEndCopyRelativeKey: "ENDED_COPY.csv",
    };

    const canWriteLambdaStep = new CanWriteLambdaStepConstruct(
      this,
      "CanWrite",
      {
        requiredRegion: Stack.of(this).region,
        allowWriteToThisAccount: props.allowWriteToInstalledAccount,
      },
    );

    const canWriteStep = canWriteLambdaStep.invocableLambda;

    // when choosing times remember
    // AWS Step Functions has a hard quota of 25,000 entries in the execution event history
    // so if a copy takes 1 month say (very worst case)... that's 30x24x60 minutes = 43,000
    // so waiting every 10 minutes would end up with 4,300 execution events - which is well
    // inside the limit

    const waitCanWriteStep = new Wait(
      this,
      "Wait X Minutes For Writeable Bucket",
      {
        time: WaitTime.duration(
          props.aggressiveTimes ? Duration.seconds(30) : Duration.minutes(10),
        ),
      },
    );

    //const waitIsThawedStep = new Wait(this, "Wait X Minutes For Thawed Objects", {
    //  time: WaitTime.duration(
    //    props.aggressiveTimes ? Duration.seconds(30) : Duration.minutes(10),
    //  ),
    //});

    const defineDefaults = new Pass(this, "Define Defaults", {
      parameters: defaults,
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

    canWriteStep.addCatch(waitCanWriteStep.next(canWriteStep), {
      errors: ["AccessDeniedError"],
    });

    canWriteStep.addCatch(fail, { errors: ["WrongRegionError"] });

    const rcloneMap = new RcloneMapConstruct(this, "RcloneMap", {
      vpc: props.vpc,
      vpcSubnetSelection: props.vpcSubnetSelection,
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
    });

    const thawObjectsMap = new ThawObjectsMapConstruct(this, "ThawObjects", {
      workingBucket: props.workingBucket,
      workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
    });

    const summariseCopyLambdaStep = new SummariseCopyLambdaStepConstruct(
      this,
      "SummariseCopy",
      {
        workingBucket: props.workingBucket,
        workingBucketPrefixKey: props.workingBucketPrefixKey ?? "",
        allowWriteToThisAccount: props.allowWriteToInstalledAccount,
      },
    );

    const definition = ChainDefinitionBody.fromChainable(
      defineDefaults
        .next(applyDefaults)
        .next(canWriteStep)
        .next(thawObjectsMap.distributedMap)
        .next(rcloneMap.distributedMap)
        .next(summariseCopyLambdaStep.invocableLambda)
        .next(success),
    );

    // NOTE: we use a technique here to allow optional input parameters to the state machine
    // by defining defaults and then JsonMerging them with the actual input params
    this._stateMachine = new StateMachine(this, "StateMachine", {
      // we might be thawing objects from S3 deep glacier (24-48 hrs)
      // we also give people a window of time in which to create the destination bucket - so this
      // could run a long time
      timeout: props.aggressiveTimes ? Duration.days(7) : Duration.days(30),
      definitionBody: definition,
    });

    thawObjectsMap.distributedMap.grantNestedPermissions(this._stateMachine);
    rcloneMap.distributedMap.grantNestedPermissions(this._stateMachine);

    // first policy is we need to let the state machine access our CSV list
    // of objects to copy, and write back to record the status of the copies
    // i.e. perms needed for result writing from distributed map (from AWS docs)
    // https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultwriter.html#resultwriter-iam-policies
    this._stateMachine.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListMultipartUploadParts",
          "s3:AbortMultipartUpload",
        ],
        resources: [
          `arn:aws:s3:::${props.workingBucket}/${
            props.workingBucketPrefixKey ?? ""
          }*`,
        ],
      }),
    );
  }

  public get stateMachine() {
    return this._stateMachine;
  }
}
