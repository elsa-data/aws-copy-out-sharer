/**
 * The only configurable item needed for the test cases - set this to a bucket you have
 * full access to. Ideally the bucket should have a lifecycle that auto expires objects after 1 day.
 * In order to keep minimal AWS permissions this is also specified
 * in the CDK deployment.
 */
export const TEST_BUCKET = "elsa-data-tmp";

/**
 * A designated area in our test bucket that is where we can find the list
 * of objects to copy - and other working files
 * NOTE: this is not where the source or destination files are located.
 */
export const TEST_BUCKET_WORKING_PREFIX = "copy-out-test-working/";

/**
 * We have a clear permissions split between the objects that we are copying - and
 * the working objects we create in doing the copy. By making sure they are in
 * different test folders - we can confirm that our permissions aren't accidentally
 * overlapping (which might mean we pass tests that later fail for real)
 */
export const TEST_BUCKET_OBJECT_PREFIX = "copy-out-test-objects/";
