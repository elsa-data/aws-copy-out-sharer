import { Construct } from "constructs";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Duration, Stack } from "aws-cdk-lib";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { join } from "path";

type SummariseCopyLambdaStepProps = {
  workingBucket: string;
  workingBucketPrefixKey: string;

  /**
   * If true, will allow this SummariseCopy lambda to write to a bucket that is
   * in the same account. Otherwise, and by default, the SummariseCopy lambda
   * is set up to not be able to write to a bucket in the same account as it
   * is installed. This is a security mechanism as writes to buckets in the
   * same account is allowed implicitly but is dangerous. This should only
   * be set to true for development/testing.
   */
  allowWriteToThisAccount?: boolean;
};

/**
 * A construct for a Steps function that collates
 * Steps results (SUCCEEDED_0.json etc) into a text file
 * that is then written to the destination bucket to show what
 * was copied.
 */
export class SummariseCopyLambdaStepConstruct extends Construct {
  public readonly invocableLambda;

  constructor(
    scope: Construct,
    id: string,
    props: SummariseCopyLambdaStepProps,
  ) {
    super(scope, id);

    const summariseCopyLambda = new NodejsFunction(
      this,
      "SummariseCopyFunction",
      {
        entry: join(
          __dirname,
          "..",
          "lambda",
          "summarise-copy-lambda",
          "summarise-copy-lambda.ts",
        ),
        runtime: Runtime.NODEJS_20_X,
        handler: "handler",
        bundling: {
          minify: false,
        },
        // this seems like plenty of seconds to do a few API calls to S3
        timeout: Duration.seconds(30),
      },
    );

    summariseCopyLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:PutObject"],
        resources: ["*"],
        // yes - that's right - we want to give this lambda the ability to attempt the writes anywhere
        // EXCEPT where we are deployed
        // (under the assumption that buckets outside our account must be giving us explicit write permission,
        //  whilst within our account we get implicit access - in this case we don't want that ability)
        conditions: props.allowWriteToThisAccount
          ? undefined
          : {
              StringNotEquals: {
                "s3:ResourceAccount": [Stack.of(this).account],
              },
            },
      }),
    );

    // we need to be able to read the results created by Steps that it placed
    // in the working folder
    summariseCopyLambda.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: [
          `arn:aws:s3:::${props.workingBucket}/${
            props.workingBucketPrefixKey ?? ""
          }*`,
        ],
      }),
    );

    this.invocableLambda = new LambdaInvoke(this, `Summarise Copy Results`, {
      inputPath: "$.ResultWriterDetails",
      lambdaFunction: summariseCopyLambda,
      resultPath: JsonPath.DISCARD,
    });
  }
}
