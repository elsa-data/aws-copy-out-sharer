# Elsa Data AWS Copy Out

A service that can be installed into an Elsa Data environment
and which enables parallel file copying out into a
destination bucket in the same region.

NOTE: this is a general purpose "S3 file copy" tool - so might
be useful outside of Elsa Data. It can certainly be invoked
directly as a Steps function independent of Elsa Data (all
the Elsa Data does is sets up the input CSVs and then invokes
the Steps function itself).

## Development

On check-out (once only) (note that `pre-commit` is presumed installed externally)

```shell
pre-commit install
```

For package installation (note that `pnpm` is presumed installed externally)

```shell
pnpm install
```

Edit the packages and deploy to dev

```shell
(in the dev folder)
pnpm run deploy
```

## Testing

Because this service is very dependent on the behaviour of AWS Steps
(using distributed maps) - it was too complex to set up a "local" test
that would actually test much of the pieces likely to fail.

Instead, development is done and the CDK project is deployed to a "dev" account (noting
that this sets the minimum dev cadence for trying changes
to minutes rather than seconds).

There is then a test script - that creates samples objects - and launches
test invocations.

## Input

```json
{
  "sourceFilesCsvBucket": "bucket-with-csv",
  "sourceFilesCsvKey": "key-of-source-files.csv",
  "destinationBucket": "a-target-bucket-in-same-region-but-not-same-account",
  "maxItemsPerBatch": 10
}
```

The copy will fan-out wide (to sensible width (~ 100)) - but there is a small AWS Config
cost to the startup/shutdown
of the Fargate tasks. Therefore the `maxItemsPerBatch` controls how many individuals files are attempted per
Fargate task - though noting that we request SPOT tasks.

So there is balance between the likelihood of SPOT interruptions v re-use of Fargate tasks. If
tasks are SPOT interrupted - then the next invocation will skip already transferred files (assuming
at least one is copied) - so it is probably safe and cheapest to leave the items per batch at 10
and be prepared to perhaps re-execute the copy.
