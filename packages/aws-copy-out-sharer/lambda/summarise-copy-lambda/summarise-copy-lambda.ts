import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { basename } from "path/posix";

interface InvokeEvent {
  Bucket: string;
  Key: string;
}

export async function handler(event: InvokeEvent) {
  console.log(JSON.stringify(event, null, 2));

  const client = new S3Client({});

  const getManifestCommand = new GetObjectCommand({
    Bucket: event.Bucket,
    Key: event.Key,
  });

  const getManifestResult = await client.send(getManifestCommand);
  const getManifestContent = await getManifestResult.Body.transformToString();

  const manifest = JSON.parse(getManifestContent);

  // {"DestinationBucket":"elsa-data-tmp",
  // "MapRunArn":"arn:aws:states:ap-southeast-2:843407916570:mapRun:CopyOutStateMachineF3E7B017-3KDB9FinLIMl/4474d22f-4056-30e3-978c-027016edac90:0c17ffd6-e8ad-44c0-a65b-a8b721007241",
  // "ResultFiles":{
  //     "FAILED":[],
  //     "PENDING":[],
  //     "SUCCEEDED":[{"Key":"copy-out-test-working/a6faea86c066cd90/1-objects-to-copy.tsv/0c17ffd6-e8ad-44c0-a65b-a8b721007241/SUCCEEDED_0.json","Size":2887}]}}
  if (manifest["ResultFiles"]) {
    const rf = manifest["ResultFiles"];

    if (rf["FAILED"] && rf["FAILED"].length > 0)
      throw new Error("Copy is meant to succeed - but it had failed results");

    if (rf["PENDING"] && rf["PENDING"].length > 0)
      throw new Error("Copy is meant to succeed - but it had pending results");

    if (!rf["SUCCEEDED"]) throw new Error("Copy is meant to succeed");

    const fileResults = {};

    for (const s of rf["SUCCEEDED"]) {
      const getSuccessCommand = new GetObjectCommand({
        Bucket: event.Bucket,
        Key: s["Key"],
      });

      const getSuccessResult = await client.send(getSuccessCommand);
      const getSuccessContent = await getSuccessResult.Body.transformToString();

      for (const row of JSON.parse(getSuccessContent)) {
        if (row["Output"]) {
          const rowOutput = JSON.parse(row["Output"]);

          //  { "bytes": 0,
          //  "checks": 0,
          //  "deletedDirs": 0,
          //  "deletes": 0,
          //  "elapsedTime": 0.2928195,
          //  "errors": 0,
          //  "eta": null,
          //  "fatalError": false,
          //  "renames": 0,
          //  "retryError": false,
          //  "serverSideCopies": 1,
          //  "serverSideCopyBytes": 9,
          //  "serverSideMoveBytes": 0,
          //  "serverSideMoves": 0,
          //  "source": "s3:elsa-data-tmp/copy-out-test-objects/d76848c9ae316e13/1-src/1.bin",
          //  "speed": 0,
          //  "totalBytes": 0,
          //  "totalChecks": 0,
          //  "totalTransfers": 1,
          //  "transferTime": 0.046778609,
          //  "transfers": 1 }
          for (const rcloneRow of rowOutput["rcloneResult"]) {
            const s = rcloneRow["source"];
            const b = basename(s);

            const copiedBytes = rcloneRow["serverSideCopyBytes"];
            const copySeconds = rcloneRow["elapsedTime"];

            fileResults[b] = {
              name: b,
              speedInMebibytesPerSecond:
                copiedBytes / copySeconds / 1024 / 1024,
            };
          }
        }
      }

      console.log(JSON.stringify(fileResults, null, 2));
    }
  } else {
    throw new Error("Missing result manifest");
  }
}
