import { SubnetType } from "aws-cdk-lib/aws-ec2";
import { StackProps } from "aws-cdk-lib";

export { SubnetType } from "aws-cdk-lib/aws-ec2";

export interface CopyOutStackProps extends StackProps {
  readonly isDevelopment?: boolean;

  /**
   * The name of a previously installed stack providing us with network/db/storage/cert infrastructure
   * via cloud formation exports.
   */
  readonly infrastructureStackName: string;

  /**
   * The choice of what subnet in the VPC we want to run this copy operation.
   */
  readonly infrastructureSubnetSelection: SubnetType;
}
