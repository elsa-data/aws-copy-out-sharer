import { Construct } from "constructs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "path";

type ThawObjectsLambdaStepProps = {
  vpc: IVpc;
  vpcSubnetSelection: SubnetType;
};

/**
 * A construct for a Steps function that tests whether an S3
 * bucket exists, is in the correct region, and is writeable
 * by us. Throws an exception if any of these conditions is not met.
 */
export class ThawObjectsLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(scope: Construct, id: string, props: ThawObjectsLambdaStepProps) {
    super(scope, id);

    const thawObjectsLambda = new NodejsFunction(this, "ThawObjectsFunction", {
      vpc: props.vpc,
      entry: join(
        __dirname,
        "..",
        "lambda",
        "thaw-objects-lambda",
        "thaw-objects-lambda.ts",
      ),
      runtime: Runtime.NODEJS_20_X,
      handler: "handler",
      bundling: {
        minify: false,
      },
      vpcSubnets: {
        subnetType: props.vpcSubnetSelection,
      },
      // this seems like plenty of seconds to do a few API calls to S3
      timeout: Duration.seconds(300),
    });

    thawObjectsLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:*"],
        resources: ["*"],
      }),
    );

    this.invocableLambda = new LambdaInvoke(
      this,
      `Are The Objects Available To Copy?`,
      {
        lambdaFunction: thawObjectsLambda,
        resultPath: JsonPath.DISCARD,
      },
    );
  }
}
