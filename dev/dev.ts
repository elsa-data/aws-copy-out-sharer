import { CopyOutStack } from "aws-copy-out-sharer";
import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { App } from "aws-cdk-lib";

const app = new App();

const description =
  "Bulk copy-out service for Elsa Data - an application for controlled genomic data sharing";

const devId = "ElsaDataDevCopyOutStack";

new CopyOutStack(app, devId, {
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
  isDevelopment: true,
  infrastructureStackName: "ElsaDataDevInfrastructureStack",
  infrastructureSubnetSelection: SubnetType.PRIVATE_WITH_EGRESS,
});
