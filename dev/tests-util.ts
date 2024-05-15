import { PutObjectCommand, S3Client, StorageClass } from "@aws-sdk/client-s3";

const s3Client = new S3Client({});

/**
 * Put a dictionary of objects as a two column CSV into an S3 object.
 *
 * @param csvBucket
 * @param csvAbsoluteKey the key of the CSV in the working folder
 * @param objects a dictionary of buckets->key[]
 */
export async function makeObjectDictionaryCsv(
  csvBucket: string,
  csvAbsoluteKey: string,
  objects: Record<string, string[]>,
) {
  let content = "";

  // for each bucket
  for (const b of Object.keys(objects)) {
    // for each key
    for (const k of objects[b]) content += `${b},"${k}"\n`;
  }

  // now save the CSV to S3
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: csvBucket,
      Key: csvAbsoluteKey,
      Body: content,
    }),
  );
}

/**
 * Makes an S3 object of a certain size and storage class - and
 * filled with basically blank data
 *
 * @param bucket the bucket of the object
 * @param key the key of the object
 * @param sizeInBytes the size in bytes of the object to make
 * @param storageClass the storage class for the object, defaults to STANDARD
 * @param forceContentByte force a content byte if the default needs to be overridden
 * @returns the byte value that is the content of the created file
 */
export async function makeTestObject(
  bucket: string,
  key: string,
  sizeInBytes: number,
  storageClass: StorageClass = "STANDARD",
  forceContentByte: number | undefined = undefined,
) {
  const contentByte =
    forceContentByte === undefined ? sizeInBytes % 256 : forceContentByte;
  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      // so rather than make every file filled with 0s - we fill
      // with a value that depends on the size... no particular
      // point other than we can I guess assert content has been
      // successfully copied by looking at the destination content after copy
      Body: Buffer.alloc(sizeInBytes, contentByte),
      StorageClass: storageClass,
    }),
  );
  return contentByte;
}
