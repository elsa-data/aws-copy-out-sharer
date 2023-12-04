import { randomBytes } from "crypto";
import { S3Client, PutObjectCommand, StorageClass } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import {
  DiscoverInstancesCommand,
  ServiceDiscoveryClient,
} from "@aws-sdk/client-servicediscovery";
import {
  TEST_BUCKET,
  TEST_BUCKET_OBJECT_PREFIX,
  TEST_BUCKET_WORKING_PREFIX,
} from "./constants";

const discoveryClient = new ServiceDiscoveryClient({});
const s3Client = new S3Client({});
const sfnClient = new SFNClient({});

// generate a unique run folder for this execution of the entire test suite
const uniqueFolder = randomBytes(8).toString("hex");

/**
 * Put a list of objects as a CSV into an object.
 *
 * @param absoluteCsvKey the key of the CSV in the working folder
 * @param keysBucket the source bucket of the objects
 * @param keys the keys of the objects
 */
async function makeObjectListCsv(
  absoluteCsvKey: string,
  keysBucket: string,
  keys: string[],
) {
  let content = "";
  for (const k of keys) {
    content += `${keysBucket},"${k}"\n`;
  }
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: TEST_BUCKET,
      Key: absoluteCsvKey,
      Body: content,
    }),
  );
}

function getPaths(testNumber: number) {
  const tsvName = `${testNumber}-objects-to-copy.tsv`;

  return {
    // because this must exist in the working folder - we need it
    // both as a relative path (how we will refer to it within the steps)
    // and an absolute path (for use outside our steps)
    testFolderObjectsTsvRelative: `${uniqueFolder}/${tsvName}`,
    testFolderObjectsTsvAbsolute: `${TEST_BUCKET_WORKING_PREFIX}${uniqueFolder}/${tsvName}`,

    testFolderSrc: `${TEST_BUCKET_OBJECT_PREFIX}${uniqueFolder}/${testNumber}-src`,
    testFolderDest: `${TEST_BUCKET_OBJECT_PREFIX}${uniqueFolder}/${testNumber}-dest/`,
  };
}

async function doTest1(stateMachineArn: string) {
  const {
    testFolderSrc,
    testFolderDest,
    testFolderObjectsTsvAbsolute,
    testFolderObjectsTsvRelative,
  } = getPaths(1);

  // 3 files in standard storage (no thawing)
  const sourceObjects = {
    [`${testFolderSrc}/1.bin`]: StorageClass.STANDARD,
    [`${testFolderSrc}/2.bin`]: StorageClass.STANDARD,
    [`${testFolderSrc}/3.bin`]: StorageClass.STANDARD,
  };

  for (const [n, stor] of Object.entries(sourceObjects)) {
    await makeTestObject(n, 256 * 1024, stor);
  }

  await makeObjectListCsv(
    testFolderObjectsTsvAbsolute,
    TEST_BUCKET,
    Object.keys(sourceObjects),
  );

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        sourceFilesCsvKey: testFolderObjectsTsvRelative,
        destinationBucket: TEST_BUCKET,
        destinationPrefixKey: testFolderDest,
        maxItemsPerBatch: 1,
      }),
    }),
  );
}

async function doTest2(stateMachineArn: string) {
  const {
    testFolderDest,
    testFolderObjectsTsvAbsolute,
    testFolderObjectsTsvRelative,
  } = getPaths(1);

  await makeObjectListCsv(testFolderObjectsTsvAbsolute, "umccr-10g-data-dev", [
    "HG00096/HG00096.hard-filtered.vcf.gz",
    "HG00097/HG00097.hard-filtered.vcf.gz",
  ]);

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        sourceFilesCsvKey: testFolderObjectsTsvRelative,
        destinationBucket: TEST_BUCKET,
        destinationPrefixKey: testFolderDest,
        maxItemsPerBatch: 1,
      }),
    }),
  );
}

// s3:///HG00096/HG00096.hard-filtered.vcf.gz
async function doTest3(stateMachineArn: string) {
  const testFolderSrc = uniqueFolder + "-src2";
  const testFolderDest = uniqueFolder + "-dest2";

  const sourceObjects = {
    [`${testFolderSrc}/1.bin`]: StorageClass.GLACIER_IR,
    [`${testFolderSrc}/2.bin`]: StorageClass.STANDARD,
    [`${testFolderSrc}/3.bin`]: StorageClass.GLACIER,
  };

  for (const [n, stor] of Object.entries(sourceObjects)) {
    await makeTestObject(n, 1000, stor);
  }

  await makeObjectListCsv(
    `${testFolderSrc}/objects-to-copy.tsv`,
    TEST_BUCKET,
    Object.keys(sourceObjects),
  );

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        sourceFilesCsvKey: `${testFolderSrc}/objects-to-copy.tsv`,
        destinationBucket: TEST_BUCKET,
        destinationPrefixKey: testFolderDest,
        maxItemsPerBatch: 1,
      }),
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
      Body: Buffer.alloc(sizeInBytes, 13),
      StorageClass: storageClass,
    }),
  );
}

async function createTestData() {}

(async () => {
  console.log(`Working folder = ${TEST_BUCKET}:${uniqueFolder}`);

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

  await doTest2(stateMachineArn);
})();
