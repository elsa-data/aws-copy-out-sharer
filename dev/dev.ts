import { CopyOutStateMachineConstruct } from "aws-copy-out-sharer";
import { SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { App, Stack, StackProps } from "aws-cdk-lib";
import { InfrastructureClient } from "@elsa-data/aws-infrastructure";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { Construct } from "constructs";
import { TEST_BUCKET, TEST_BUCKET_WORKING_PREFIX } from "./constants";

const app = new App();

const description =
  "Bulk copy-out service for Elsa Data - an application for controlled genomic data sharing";

const devId = "ElsaDataDevCopyOutStack";
const agId = "ElsaDataAgCopyOutStack";

/**
 * Wraps the copy out construct for development purposes. We don't do this Stack definition in the
 * construct itself - as unlike some other Elsa Data constructs - there may be general
 * utility to the copy out service (i.e. we want to let people just install the Copy Out
 * state machine without elsa infrastructure). But for dev purposes we are developing
 * this in conjunction with Elsa Data - so we register it into the namespace and use a common
 * VPC etc.
 */
class ElsaDataCopyOutStack extends Stack {
  constructor(scope?: Construct, id?: string, props?: StackProps) {
    super(scope, id, props);

    // our client unlocks the ability to fetch/create CDK objects that match our
    // installed infrastructure stack (by infrastructure stack name)
    const infraClient = new InfrastructureClient(
      "ElsaDataDevInfrastructureStack",
    );

    const vpc = infraClient.getVpcFromLookup(this);

    const namespace = infraClient.getNamespaceFromLookup(this);

    const service = new Service(this, "Service", {
      namespace: namespace,
      name: "CopyOut",
      description: "Parallel file copying service",
    });

    const copyOut = new CopyOutStateMachineConstruct(this, "CopyOut", {
      vpc: vpc,
      vpcSubnetSelection: SubnetType.PRIVATE_WITH_EGRESS,
      workingBucket: TEST_BUCKET,
      workingBucketPrefixKey: TEST_BUCKET_WORKING_PREFIX,
      aggressiveTimes: true,
      allowWriteToInstalledAccount: true,
    });

    service.registerNonIpInstance("StateMachine", {
      customAttributes: {
        stateMachineArn: copyOut.stateMachine.stateMachineArn,
      },
    });
  }
}

new ElsaDataCopyOutStack(app, devId, {
  // the stack can only be deployed to 'dev'
  env: {
    account: "843407916570",
    region: "ap-southeast-2",
  },
  tags: {
    "umccr-org:Product": "ElsaData",
    "umccr-org:Stack": devId,
  },
  description: description,
});

/**
 * Wraps an even simpler deployment direct for AG. We have needs to do AG copies
 * outside of Elsa. This is also a good test of the copy-out mechanics. So this
 * allows us to directly deploy/destroy.
 */
class ElsaDataSimpleCopyOutStack extends Stack {
  constructor(scope?: Construct, id?: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, "Vpc", { vpcName: "main-vpc" });

    const copyOut = new CopyOutStateMachineConstruct(this, "CopyOut", {
      vpc: vpc,
      vpcSubnetSelection: SubnetType.PRIVATE_WITH_EGRESS,
      workingBucket: "elsa-data-copy-working",
      workingBucketPrefixKey: "temp/",
      aggressiveTimes: false,
      allowWriteToInstalledAccount: true,
    });

    //stateMachineArn: copyOut.stateMachine.stateMachineArn,
  }
}

new ElsaDataSimpleCopyOutStack(app, agId, {
  // the stack can only be deployed to 'dev'
  env: {
    account: "602836945884",
    region: "ap-southeast-2",
  },
  tags: {
    "umccr-org:Product": "ElsaData",
    "umccr-org:Stack": agId,
  },
  description: description,
});
