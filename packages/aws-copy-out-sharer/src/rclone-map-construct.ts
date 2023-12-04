import { Construct } from "constructs";
import { JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { S3CsvDistributedMap } from "./s3-csv-distributed-map";
import { RcloneRunTaskConstruct } from "./rclone-run-task-construct";
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import { SOURCE_FILES_CSV_KEY_FIELD_NAME } from "./copy-out-state-machine-input";

type Props = {
  vpc: IVpc;
  vpcSubnetSelection: SubnetType;

  workingBucket: string;
  workingBucketPrefixKey: string;
};

export class RcloneMapConstruct extends Construct {
  public readonly distributedMap: S3CsvDistributedMap;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const cluster = new Cluster(this, "FargateCluster", {
      vpc: props.vpc,
      enableFargateCapacityProviders: true,
    });

    const rcloneRunTask = new RcloneRunTaskConstruct(
      this,
      "RcloneFargateTask",
      {
        fargateCluster: cluster,
        vpcSubnetSelection: props.vpcSubnetSelection,
      },
    ).ecsRunTask;

    // our task is an idempotent copy operation so we can retry if we happen to get killed
    // (possible given we are using Spot fargate)
    rcloneRunTask.addRetry({
      errors: ["States.TaskFailed"],
      maxAttempts: 3,
    });

    // these names are internal only - but we pull out as a const to make sure
    // they are consistent
    const bucketColumnName = "b";
    const keyColumnName = "k";

    // {
    //   "BatchInput": {
    //     "rcloneDestination": "s3:cpg-cardiac-flagship-transfer/optionalpath"
    //   },
    //   "Items": [
    //     {
    //       "rcloneSource": "s3:bucket/1.fastq.gz"
    //     },
    //     {
    //       "rcloneSource": "s3:bucket/2.fastq.gz"
    //     },
    // }

    this.distributedMap = new S3CsvDistributedMap(this, "RcloneMap", {
      toleratedFailurePercentage: 25,
      itemReaderCsvHeaders: [bucketColumnName, keyColumnName],
      itemReader: {
        Bucket: props.workingBucket,
        "Key.$": JsonPath.format(
          "{}{}",
          props.workingBucketPrefixKey,
          JsonPath.stringAt(`$.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`),
        ),
      },
      itemSelector: {
        "rcloneSource.$": JsonPath.format(
          // note: this is not an s3:// URL, it is the peculiar syntax used by rclone
          "s3:{}/{}",
          JsonPath.stringAt(`$$.Map.Item.Value.${bucketColumnName}`),
          JsonPath.stringAt(`$$.Map.Item.Value.${keyColumnName}`),
        ),
      },
      batchInput: {
        "rcloneDestination.$": JsonPath.format(
          "s3:{}/{}",
          JsonPath.stringAt(`$.destinationBucket`),
          JsonPath.stringAt("$.destinationPrefixKey"),
        ),
      },
      iterator: rcloneRunTask,
      resultWriter: {
        Bucket: props.workingBucket,
        "Prefix.$": JsonPath.format(
          "{}{}",
          props.workingBucketPrefixKey,
          JsonPath.stringAt(`$.${SOURCE_FILES_CSV_KEY_FIELD_NAME}`),
        ),
      },
    });
  }
}
