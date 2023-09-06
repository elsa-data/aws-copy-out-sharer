import { Construct } from "constructs";
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";
import { IntegrationPattern, JsonPath } from "aws-cdk-lib/aws-stepfunctions";
import { Duration, Stack, Tags } from "aws-cdk-lib";
import {
  AssetImage,
  CpuArchitecture,
  FargatePlatformVersion,
  FargateTaskDefinition,
  ICluster,
  LogDriver,
} from "aws-cdk-lib/aws-ecs";
import {
  EcsFargateLaunchTargetOptions,
  EcsLaunchTargetConfig,
  EcsRunTask,
  IEcsLaunchTarget,
  LaunchTargetBindOptions,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { join } from "path";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { SubnetType } from "aws-cdk-lib/aws-ec2";

type Props = {
  fargateCluster: ICluster;
  vpcSubnetSelection: SubnetType;
};

export class FargateRunTaskConstruct extends Construct {
  public readonly ecsRunTask: EcsRunTask;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id);

    const taskDefinition = new FargateTaskDefinition(this, "Td", {
      runtimePlatform: {
        // FARGATE_SPOT is only available for X86
        cpuArchitecture: CpuArchitecture.X86_64,
      },
      cpu: 256,
      // there is a warning in the rclone documentation about problems with mem < 1GB - but I think that
      // is mainly for large syncs.. we do individual file copies so 512 should be fine
      memoryLimitMiB: 512,
    });

    Tags.of(taskDefinition).add("test", "tag");

    // we need to give the rclone task the ability to do the copy out in S3
    // TODO can we limit this to reading from our designated buckets and writing out
    taskDefinition.taskRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess")
    );

    const containerDefinition = taskDefinition.addContainer("RcloneContainer", {
      // set the stop timeout to the maximum allowed under Fargate - as potentially this will let us finish
      // our rclone operation
      stopTimeout: Duration.seconds(120),
      image: new AssetImage(
        join(
          __dirname,
          "..",
          "..",
          "artifacts",
          "rclone-batch-copy-docker-image"
        ),
        {
          // note we are forcing the X86 platform because we want to use Fargate spot which is only available intel/x86
          platform: Platform.LINUX_AMD64,
        }
      ),
      logging: LogDriver.awsLogs({
        streamPrefix: "elsa-data-copy-out",
        logRetention: RetentionDays.ONE_WEEK,
      }),
      environment: {
        RCLONE_CONFIG_S3_TYPE: "s3",
        RCLONE_CONFIG_S3_PROVIDER: "AWS",
        RCLONE_CONFIG_S3_ENV_AUTH: "true",
        RCLONE_CONFIG_S3_REGION: Stack.of(this).region,
      },
    });

    // RCLONE_CONFIG_S3_TYPE=s3 RCLONE_CONFIG_S3_PROVIDER=AWS RCLONE_CONFIG_S3_ENV_AUTH=true RCLONE_CONFIG_S3_REGION=ap-southeast-2 rclone copy src dest

    // https://github.com/aws/aws-cdk/issues/20013
    this.ecsRunTask = new EcsRunTask(this, "Copy File with Rclone", {
      integrationPattern: IntegrationPattern.RUN_JOB,
      cluster: props.fargateCluster,
      taskDefinition: taskDefinition,
      launchTarget: new EcsFargateSpotOnlyLaunchTarget({
        platformVersion: FargatePlatformVersion.VERSION1_4,
      }),
      subnets: {
        subnetType: props.vpcSubnetSelection,
      },
      resultSelector: {
        // NOTE almost any amount of output can cause the joint result to overflow..
        // best to look up all this data at the ECS Task level
        // have left these here to show how you can export ECS output if you want
        // "capacityProviderName.$": JsonPath.stringAt("$.CapacityProviderName"),
        // "stoppedAt.$": JsonPath.numberAt("$.StoppedAt"),
        // "stoppedReason.$": JsonPath.stringAt("$.StoppedReason"),
      },
      containerOverrides: [
        {
          containerDefinition: containerDefinition,
          command: JsonPath.listAt("$.Items[*].source"),
          environment: [
            {
              name: "destination",
              value: JsonPath.stringAt(
                "$.BatchInput.destinationBucketForRclone"
              ),
            },
          ],
        },
      ],
    });
  }
}

class EcsFargateSpotOnlyLaunchTarget implements IEcsLaunchTarget {
  constructor(private readonly options?: EcsFargateLaunchTargetOptions) {}

  /**
   * Called when the Fargate launch type configured on RunTask
   */
  public bind(
    _task: EcsRunTask,
    launchTargetOptions: LaunchTargetBindOptions
  ): EcsLaunchTargetConfig {
    if (!launchTargetOptions.taskDefinition.isFargateCompatible) {
      throw new Error("Supplied TaskDefinition is not compatible with Fargate");
    }

    return {
      parameters: {
        PlatformVersion: this.options?.platformVersion,
        CapacityProviderStrategy: [
          {
            CapacityProvider: "FARGATE_SPOT",
          },
        ],
        // naughty - this is really nothing to do with LaunchType but this is a way
        // we can set properties in the Steps Run Task ASL
        // in this case we want to be able to track compute used so we propagate
        // through the tags from the task definition (which will come from the Stack/Construct)
        PropagateTags: "TASK_DEFINITION",
      },
    };
  }
}

/*
An example output from an ECS runtask

{
  "Attachments": [
    {
      "Details": [
        {
          "Name": "subnetId",
          "Value": "subnet-035b8252d7f6edee1"
        },
        {
          "Name": "networkInterfaceId",
          "Value": "eni-077e4eb4385083b95"
        },
        {
          "Name": "macAddress",
          "Value": "06:9a:85:f4:35:d8"
        },
        {
          "Name": "privateDnsName",
          "Value": "ip-10-0-64-84.ap-southeast-2.compute.internal"
        },
        {
          "Name": "privateIPv4Address",
          "Value": "10.0.64.84"
        }
      ],
      "Id": "c06f9ba6-3cfb-472a-bbd2-a02cf5d3ef4d",
      "Status": "DELETED",
      "Type": "eni"
    }
  ],
  "Attributes": [
    {
      "Name": "ecs.cpu-architecture",
      "Value": "x86_64"
    }
  ],
  "AvailabilityZone": "ap-southeast-2b",
  "CapacityProviderName": "FARGATE_SPOT",
  "ClusterArn": "arn:aws:ecs:ap-southeast-2:602836945884:cluster/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS",
  "Connectivity": "CONNECTED",
  "ConnectivityAt": 1680596446117,
  "Containers": [
    {
      "ContainerArn": "arn:aws:ecs:ap-southeast-2:602836945884:container/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS/2696321ed56a477d9fc75f7e4f037ba2/3d49f64d-56af-4106-b027-40c1cd407b66",
      "Cpu": "0",
      "ExitCode": 0,
      "GpuIds": [],
      "Image": "602836945884.dkr.ecr.ap-southeast-2.amazonaws.com/cdk-hnb659fds-container-assets-602836945884-ap-southeast-2:307e4b58f91d748a9d6c233f7e04e6bcd5e19f27290a4481c2e007cc25a2ae93",
      "ImageDigest": "sha256:REDACTED",
      "LastStatus": "STOPPED",
      "ManagedAgents": [],
      "Name": "RcloneContainer",
      "NetworkBindings": [],
      "NetworkInterfaces": [
        {
          "AttachmentId": "c06f9ba6-3cfb-472a-bbd2-a02cf5d3ef4d",
          "PrivateIpv4Address": "10.0.64.84"
        }
      ],
      "RuntimeId": "ABCD-123",
      "TaskArn": "arn:aws:ecs:ap-southeast-2:602836945884:task/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS/2696321ed56a477d9fc75f7e4f037ba2"
    }
  ],
  "Cpu": "256",
  "CreatedAt": 1680596442871,
  "DesiredStatus": "STOPPED",
  "EnableExecuteCommand": false,
  "EphemeralStorage": {
    "SizeInGiB": 20
  },
  "ExecutionStoppedAt": 1680596471735,
  "Group": "family:ElsaDataAgCopyOutStackCopyOutRcloneFargateTaskTdC05A385E",
  "InferenceAccelerators": [],
  "LastStatus": "STOPPED",
  "LaunchType": "FARGATE",
  "Memory": "512",
  "Overrides": {
    "ContainerOverrides": [
      {
        "Command": [
          "s3:bucket:1.fastq.gz",
          "s3:bucket:2.fastq.gz",
          "s3:bucket:3.fastq.gz",
          "s3:bucket:4.fastq.gz"
        ],
        "Environment": [
          {
            "Name": "destination",
            "Value": "s3:bucket-at-destination"
          }
        ],
        "EnvironmentFiles": [],
        "Name": "RcloneContainer",
        "ResourceRequirements": []
      }
    ],
    "InferenceAcceleratorOverrides": []
  },
  "PlatformVersion": "1.4.0",
  "PullStartedAt": 1680596461639,
  "PullStoppedAt": 1680596463273,
  "StartedAt": 1680596463814,
  "StartedBy": "AWS Step Functions",
  "StopCode": "EssentialContainerExited",
  "StoppedAt": 1680596504771,
  "StoppedReason": "Essential container in task exited",
  "StoppingAt": 1680596481818,
  "Tags": [],
  "TaskArn": "arn:aws:ecs:ap-southeast-2:602836945884:task/ElsaDataAgCopyOutStack-FargateCluster7CCD5F93-Fqt1RPmV8sGS/2696321ed56a477d9fc75f7e4f037ba2",
  "TaskDefinitionArn": "arn:aws:ecs:ap-southeast-2:602836945884:task-definition/ElsaDataAgCopyOutStackCopyOutRcloneFargateTaskTdC05A385E:1",
  "Version": 5
}
 */
