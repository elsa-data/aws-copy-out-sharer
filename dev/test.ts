import { randomBytes } from "crypto";
import { S3Client, PutObjectCommand, StorageClass } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import {
  DiscoverInstancesCommand,
  ServiceDiscoveryClient,
} from "@aws-sdk/client-servicediscovery";

/**
 * The only configurable item needed for the test cases - set this to a bucket you have
 * full access to. Ideally the bucket should have a lifecycle that auto expires objects after 1 day.
 */
const TEST_BUCKET = "elsa-data-tmp";

const discoveryClient = new ServiceDiscoveryClient({});
const s3Client = new S3Client({});
const sfnClient = new SFNClient({});

const testFolder = randomBytes(16).toString("hex");
const testFolderSrc = testFolder + "-src";
const testFolderDest = testFolder + "-dest";

async function makeObjectListCsv(key: string, keys: string[]) {
  let content = "";
  for (const k of keys) {
    content += `${TEST_BUCKET},"${k}"\n`;
  }
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: TEST_BUCKET,
      Key: key,
      Body: content,
    }),
  );
}

async function makeTestObject(
  key: string,
  sizeInBytes: number,
  storageClass: StorageClass = "STANDARD",
) {
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: TEST_BUCKET,
      Key: key,
      Body: "Hello S3!",
      StorageClass: storageClass,
    }),
  );
}

async function createTestData() {
  const sourceObjects = {
    [`${testFolderSrc}/1.bin`]: StorageClass.DEEP_ARCHIVE,
    [`${testFolderSrc}/2.bin`]: StorageClass.STANDARD,
    [`${testFolderSrc}/3.bin`]: StorageClass.GLACIER,
  };

  for (const [n, stor] of Object.entries(sourceObjects)) {
    await makeTestObject(n, 1000, stor);
  }

  await makeObjectListCsv(
    `${testFolderSrc}/objects-to-copy.tsv`,
    Object.keys(sourceObjects),
  );
}

(async () => {
  console.log(`Src objects = ${TEST_BUCKET}:${testFolderSrc}`);
  console.log(`Dest objects = ${TEST_BUCKET}:${testFolderDest}`);

  const stepsDiscover = await discoveryClient.send(
    new DiscoverInstancesCommand({
      NamespaceName: "elsa-data",
      ServiceName: "CopyOut",
    }),
  );

  if (
    !stepsDiscover ||
    !stepsDiscover.Instances ||
    stepsDiscover.Instances.length != 1
  )
    throw new Error(
      "Did not discover the expected number of CopyOut instances in the Elsa Data CloudMap",
    );

  const stateMachineDiscovered = stepsDiscover?.Instances[0];

  if (!stateMachineDiscovered.Attributes)
    throw new Error(
      "Did not discover state machine settings in CopyOut CloudMap",
    );

  const stateMachineArn = stateMachineDiscovered.Attributes["stateMachineArn"];

  await createTestData();

  /*await sfnClient.send(new StartExecutionCommand({
    stateMachineArn: stateMachineArn,
    input: JSON.stringify({
      sourceFilesCsvBucket: TEST_BUCKET,
      sourceFilesCsvKey: `${testFolderSrc}/objects-to-copy.tsv`,
      destinationBucket: TEST_BUCKET,
      maxItemsPerBatch: 1
    })
  }));*/

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        sourceFilesCsvBucket: TEST_BUCKET,
        sourceFilesCsvKey: `${testFolderSrc}/objects-to-copy.tsv`,
        destinationBucket: TEST_BUCKET,
        destinationKey: testFolderDest,
        maxItemsPerBatch: 1,
      }),
    }),
  );
})();
