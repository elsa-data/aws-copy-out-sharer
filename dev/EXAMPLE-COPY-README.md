How to do a full scale invoke test.

Go to "elsa-data-tmp" bucket in dev.
It probably will be empty as objects auto-expire.
Make a folder "copy-out-test-working".
Copy "example-copy-manifest.csv" to that folder.

THE FOLDER MUST BE EXACTLY AS SPECIFIED AS THAT PERMISSION IS BAKED INTO
THE DEV DEPLOYMENT (IN ORDER TO TEST PERMISSIONS!)

Invoke the dev Steps with the input

{
"sourceFilesCsvBucket": "elsa-data-tmp",
"sourceFilesCsvKey": "example-copy-manifest.csv",
"destinationBucket": "elsa-data-copy-target-sydney",
"maxItemsPerBatch": 2
}
