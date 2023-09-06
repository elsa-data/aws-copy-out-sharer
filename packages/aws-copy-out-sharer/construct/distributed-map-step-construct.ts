import { Construct } from "constructs";
import {
  CustomState,
  IChainable,
  JsonPath,
  Map,
} from "aws-cdk-lib/aws-stepfunctions";

type Props = {
  task: IChainable;
};

export class DistributedMapStepConstruct extends Construct {
  public readonly distributedMapStep: CustomState;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    // This is a workaround from the following issue
    // https://github.com/aws/aws-cdk/issues/23216
    // awaiting native support for a Distributed Map in CDK
    // this uses a dummy map in order to generate all the fields we
    // need to iterate over our ECS task
    const dummyMap = new Map(this, "DummyMap");
    dummyMap.iterator(props.task);
    const mapItemProcessor = (dummyMap.toStateJson() as any).Iterator;

    // {
    //   "BatchInput": {
    //     "destinationBucketForRclone": "s3:cpg-cardiac-flagship-transfer"
    //   },
    //   "Items": [
    //     {
    //       "source": "s3:bucket/1.fastq.gz"
    //     },
    //     {
    //       "source": "s3:bucket/2.fastq.gz"
    //     },
    // }

    // these names are internal only - but we pull out as a const to make sure
    // they are consistent
    const bucketColumnName = "b";
    const keyColumnName = "k";

    this.distributedMapStep = new CustomState(this, "DistributedMap", {
      stateJson: {
        // https://states-language.net/#map-state
        Type: "Map",
        // we need to be careful of the concurrency of the Fargate RunTask..
        // not sure distributed map knows how to handle back-off??
        // https://docs.aws.amazon.com/AmazonECS/latest/userguide/throttling.html
        MaxConcurrency: 80,
        ToleratedFailurePercentage: 25,
        ItemReader: {
          ReaderConfig: {
            InputType: "CSV",
            // note we are providing the nominal column names.. there is no header row in the CSV
            CSVHeaderLocation: "GIVEN",
            CSVHeaders: [bucketColumnName, keyColumnName],
          },
          Resource: "arn:aws:states:::s3:getObject",
          Parameters: {
            "Bucket.$": "$.sourceFilesCsvBucket",
            "Key.$": "$.sourceFilesCsvKey",
          },
        },
        ItemBatcher: {
          MaxItemsPerBatchPath: JsonPath.stringAt("$.maxItemsPerBatch"),
          BatchInput: {
            "destinationBucketForRclone.$": JsonPath.format(
              "s3:{}",
              JsonPath.stringAt("$.destinationBucket")
            ),
          },
        },
        ItemProcessor: {
          ...mapItemProcessor,
          ProcessorConfig: {
            Mode: "DISTRIBUTED",
            ExecutionType: "STANDARD",
          },
        },
        ItemSelector: {
          "source.$": JsonPath.format(
            // note: this is not an s3:// URL, it is the peculiar syntax used by rclone
            "s3:{}/{}",
            JsonPath.stringAt(`$$.Map.Item.Value.${bucketColumnName}`),
            JsonPath.stringAt(`$$.Map.Item.Value.${keyColumnName}`)
          ),
        },
      },
    });
  }
}
