import { Stack } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CopyOutStackProps } from "./copy-out-stack-props";
import { Cluster } from "aws-cdk-lib/aws-ecs";
import { CopyOutStateMachineConstruct } from "./construct/copy-out-state-machine-construct";
import { Service } from "aws-cdk-lib/aws-servicediscovery";
import { InfrastructureClient } from "@elsa-data/aws-infrastructure-client";

export { CopyOutStackProps, SubnetType } from "./copy-out-stack-props";

export class CopyOutStack extends Stack {
  constructor(scope: Construct, id: string, props: CopyOutStackProps) {
    super(scope, id, props);

    // our client unlocks the ability to fetch/create CDK objects that match our
    // installed infrastructure stack (by infrastructure stack name)
    const infraClient = new InfrastructureClient(props.infrastructureStackName);

    const vpc = infraClient.getVpcFromLookup(this);

    const namespace = infraClient.getNamespaceFromLookup(this);

    const cluster = new Cluster(this, "FargateCluster", {
      vpc: vpc,
      enableFargateCapacityProviders: true,
    });

    const service = new Service(this, "Service", {
      namespace: namespace,
      name: "CopyOut",
      description: "Parallel file copying service",
    });

    new CopyOutStateMachineConstruct(this, "CopyOut", {
      vpc: vpc,
      vpcSubnetSelection: props.infrastructureSubnetSelection,
      fargateCluster: cluster,
      namespaceService: service,
      aggressiveTimes: props.isDevelopment,
    });
  }
}
