const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

export const handler = async (event) => {
  function WrongRegionError(message) {
    this.name = "WrongRegionError";
    this.message = message;
  }
  WrongRegionError.prototype = new Error();

  function AccessDeniedError(message) {
    this.name = "AccessDeniedError";
    this.message = message;
  }
  AccessDeniedError.prototype = new Error();

  console.log(event.requiredRegion);
  console.log(event.destinationBucket);

  // we are being super specific here - the required region is where we are going
  // to make our client - in order to ensure we get 301 Redirects for buckets outside our location
  const client = new S3Client({ region: event.requiredRegion });

  try {
    const putCommand = new PutObjectCommand({
      Bucket: event.destinationBucket,
      Key: "ELSA_DATA_STARTED_TRANSFER.txt",
      Body: "A file created by Elsa Data copy out to ensure correct permissions",
    });

    const response = await client.send(putCommand);
  } catch (e) {
    if (e.Code === "PermanentRedirect")
      throw new WrongRegionError(
        "S3 Put failed because bucket was in the wrong region"
      );

    if (e.Code === "AccessDenied")
      throw new AccessDeniedError("S3 Put failed with access denied error");

    throw e;
  }
};

/*handler({
  requiredRegion: "ap-southeast-2",
  //destinationBucket: "elsa-data-tmp"
  //destinationBucket: "cdk-hnb659fds-assets-843407916570-us-east-1"
  //destinationBucket: "elsa-data-replication-target-foo"
  destinationBucket: "elsa-data-replication-target"
  // destinationBucket: "elsa-data-copy-target-sydney"
  // destinationBucket: "elsa-data-copy-target-tokyo"
}) */
