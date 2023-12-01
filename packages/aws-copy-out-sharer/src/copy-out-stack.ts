import { Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CopyOutStackProps } from "./copy-out-stack-props";
import { CopyOutStateMachineConstruct } from "./copy-out-state-machine-construct";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { InfrastructureClient } from "@elsa-data/aws-infrastructure";

export { CopyOutStackProps, SubnetType } from "./copy-out-stack-props";

export class CopyOutStack extends Stack {
  constructor(scope: Construct, id: string, props: CopyOutStackProps) {
    super(scope, id, props);

    // our client unlocks the ability to fetch/create CDK objects that match our
    // installed infrastructure stack (by infrastructure stack name)
    const infraClient = new InfrastructureClient(props.infrastructureStackName);

    const vpc = infraClient.getVpcFromLookup(this);

    const namespace = infraClient.getNamespaceFromLookup(this);

    const service = new Service(this, "Service", {
      namespace: namespace,
      name: "CopyOut",
      description: "Parallel file copying service",
    });

    const copyOut = new CopyOutStateMachineConstruct(this, "CopyOut", {
      vpc: vpc,
      vpcSubnetSelection: props.infrastructureSubnetSelection,
      aggressiveTimes: props.isDevelopment,
      allowWriteToThisAccount: props.isDevelopment,
    });

    service.registerNonIpInstance("StateMachine", {
      customAttributes: {
        stateMachineArn: copyOut.stateMachine.stateMachineArn,
      },
    });
  }
}
