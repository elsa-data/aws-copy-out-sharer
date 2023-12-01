import { Construct } from "constructs";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { S3CsvDistributedMap } from "./s3-csv-distributed-map";
import { ThawObjectsLambdaStepConstruct } from "./thaw-objects-lambda-step-construct";
import { Duration } from "aws-cdk-lib";
import { CopyOutStateMachineInputKeys } from "./copy-out-state-machine-input";

type Props = {};

export class ThawObjectsMapConstruct extends Construct {
  public readonly distributedMap: S3CsvDistributedMap;

  constructor(scope: Construct, id: string, _props: Props) {
    super(scope, id);

    const thawObjectsLambdaStep = new ThawObjectsLambdaStepConstruct(
      this,
      "LambdaStep",
      {},
    );

    thawObjectsLambdaStep.invocableLambda.addRetry({
      errors: ["IsThawingError"],
      interval: Duration.minutes(1),
      backoffRate: 1,
      maxAttempts: 15,
    });

    // these names are internal only - but we pull out as a const to make sure
    // they are consistent
    const bucketColumnName = "b";
    const keyColumnName = "k";

    // this odd construct just makes sure that the JSON paths we specify
    // here correspond with fields in the master "input" schema for the
    // overall Steps function
    const bucketKeyName: CopyOutStateMachineInputKeys = "sourceFilesCsvBucket";
    const keyKeyName: CopyOutStateMachineInputKeys = "sourceFilesCsvKey";

    this.distributedMap = new S3CsvDistributedMap(this, "ThawObjectsMap", {
      // we do not expect any failures of these functions and if we
      // do - we are fully prepared for us to move onto the rclone
      // steps where we will get proper error messages if the copies fail
      toleratedFailurePercentage: 100,
      itemReaderCsvHeaders: [bucketColumnName, keyColumnName],
      itemReader: {
        "Bucket.$": `$.${bucketKeyName}`,
        "Key.$": `$.${keyKeyName}`,
      },
      itemSelector: {
        "bucket.$": JsonPath.stringAt(`$$.Map.Item.Value.${bucketColumnName}`),
        "key.$": JsonPath.stringAt(`$$.Map.Item.Value.${keyColumnName}`),
      },
      batchInput: {
        glacierFlexibleRetrievalThawDays: 1,
        glacierFlexibleRetrievalThawSpeed: "Expedited",
        glacierDeepArchiveThawDays: 1,
        glacierDeepArchiveThawSpeed: "Standard",
        intelligentTieringArchiveThawDays: 1,
        intelligentTieringArchiveThawSpeed: "Standard",
        intelligentTieringDeepArchiveThawDays: 1,
        intelligentTieringDeepArchiveThawSpeed: "Standard",
      },
      iterator: thawObjectsLambdaStep.invocableLambda,
      resultPath: JsonPath.DISCARD,
    });
  }
}

/*
{\"BatchInput\":{\"rcloneDestination\":" +
"\"s3:elsa-data-tmp/8e467a3e27e1e0b73fcd15b5c419e53c-dest\"}," +
"\"Items\":[" +
"{\"rcloneSource\":\"s3:elsa-data-tmp/8e467a3e27e1e0b73fcd15b5c419e53c-src/1.bin\"}," +
"{\"rcloneSource\":\"s3:elsa-data-tmp/8e467a3e27e1e0b73fcd15b5c419e53c-src/2.bin\"}," +
"{\"rcloneSource\":\"s3:elsa-data-tmp/8e467a3e27e1e0b73fcd15b5c419e53c-src/3.bin\"}]," +
"\"rcloneResult\":[" +
"{\"bytes\":0,\"checks\":0,\"deletedDirs\":0,\"deletes\":0,\"elapsedTime\":0.355840879,\"errors\":0,\"eta\":null,\"fatalError\":false,\"renames\":0,\"retryError\":false,\"serverSideCopies\":1,\"serverSideCopyBytes\":9,\"serverSideMoveBytes\":0,\"serverSideMoves\":0,\"source\":\"s3:elsa-data-tmp/8e467a3e27e1e0b73fcd15b5c419e53c-src/1.bin\",\"speed\":0,\"totalBytes\":0,\"totalChecks\":0,\"totalTransfers\":1,\"transferTime\":0.057049542,\"transfers\":1}," +
"{\"bytes\":0,\"checks\":0,\"deletedDirs\":0,\"deletes\":0,\"elapsedTime\":0.368602993,\"errors\":0,\"eta\":null,\"fatalError\":false,\"renames\":0,\"retryError\":false,\"serverSideCopies\":1,\"serverSideCopyBytes\":9,\"serverSideMoveBytes\":0,\"serverSideMoves\":0,\"source\":\"s3:elsa-data-tmp/8e467a3e27e1e0b73fcd15b5c419e53c-src/2.bin\",\"speed\":0,\"totalBytes\":0,\"totalChecks\":0,\"totalTransfers\":1,\"transferTime\":0.044628996,\"transfers\":1}," +
"{\"bytes\":0,\"checks\":0,\"deletedDirs\":0,\"deletes\":0,\"elapsedTime\":0.385300283,\"errors\":0,\"eta\":null,\"fatalError\":false,\"renames\":0,\"retryError\":false,\"serverSideCopies\":1,\"serverSideCopyBytes\":9,\"serverSideMoveBytes\":0,\"serverSideMoves\":0,\"source\":\"s3:elsa-data-tmp/8e467a3e27e1e0b73fcd15b5c419e53c-src/3.bin\",\"speed\":0,\"totalBytes\":0,\"totalChecks\":0,\"totalTransfers\":1,\"transferTime\":0.05217003,\"transfers\":1}]}

 */
