import { Construct } from "constructs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration, Stack } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "path";

type CanWriteLambdaStepProps = {
  vpc: IVpc;
  vpcSubnetSelection: SubnetType;

  requiredRegion: string;
};

/**
 * A construct for a Steps function that tests whether an S3
 * bucket exists, is in the correct region, and is writeable
 * by us. Throws an exception if any of these conditions is not met.
 */
export class CanWriteLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(scope: Construct, id: string, props: CanWriteLambdaStepProps) {
    super(scope, id);

    const canWriteLambda = new NodejsFunction(this, "CanWriteFunction", {
      vpc: props.vpc,
      entry: join(
        __dirname,
        "..",
        "..",
        "artifacts",
        "can-write-lambda",
        "can-write-lambda.js"
      ),
      handler: "handler",
      vpcSubnets: {
        subnetType: props.vpcSubnetSelection,
      },
      runtime: Runtime.NODEJS_18_X,
      // this seems like plenty of seconds to do a few API calls to S3
      timeout: Duration.seconds(30),
    });

    canWriteLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:PutObject"],
        resources: ["*"],
        conditions: {
          // yes - that's right - we want to give this lambda the ability to attempt the writes anywhere
          // EXCEPT where we are deployed
          // (under the assumption that buckets outside our account must be giving us explicit write permission,
          //  whilst within our account we get implicit access - in this case we don't want that ability)
          StringNotEquals: {
            "s3:ResourceAccount": [Stack.of(this).account],
          },
        },
      })
    );

    this.invocableLambda = new LambdaInvoke(
      this,
      `Can Write To Destination Bucket?`,
      {
        lambdaFunction: canWriteLambda,
        resultPath: JsonPath.DISCARD,
      }
    );
  }
}
