import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AccessDeniedError, WrongRegionError } from "./errors";

interface InvokeEvent {
  requiredRegion: string;
  destinationBucket: string;
}

export async function handler(event: InvokeEvent) {
  console.log(JSON.stringify(event, null, 2));

  // we are being super specific here - more so than our normal client creation
  // the "required region" is where we are going
  // to make our client - in order to ensure we get 301 Redirects for buckets outside our location
  const client = new S3Client({ region: event.requiredRegion });

  try {
    const putCommand = new PutObjectCommand({
      Bucket: event.destinationBucket,
      Key: "ELSA_DATA_STARTED_TRANSFER.txt",
      Body: "A file created by Elsa Data copy out to ensure correct permissions",
    });

    await client.send(putCommand);
  } catch (e: any) {
    if (e.Code === "PermanentRedirect")
      throw new WrongRegionError(
        "S3 Put failed because bucket was in the wrong region",
      );

    if (e.Code === "AccessDenied")
      throw new AccessDeniedError("S3 Put failed with access denied error");

    throw e;
  }
}

/*handler({
  requiredRegion: "ap-southeast-2",
  //destinationBucket: "elsa-data-tmp"
  //destinationBucket: "cdk-hnb659fds-assets-843407916570-us-east-1"
  //destinationBucket: "elsa-data-replication-target-foo"
  destinationBucket: "elsa-data-replication-target"
  // destinationBucket: "elsa-data-copy-target-sydney"
  // destinationBucket: "elsa-data-copy-target-tokyo"
}) */