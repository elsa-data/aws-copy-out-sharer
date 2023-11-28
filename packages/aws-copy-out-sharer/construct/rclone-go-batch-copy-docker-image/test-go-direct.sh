#!/bin/bash

# this is a setting which is system dependent - feel free to change to the location of your
# dev system rclone binary (this one is brew installed on a Mac M1)
RCLONE_BINARY=$(which rclone)

# we want to exit immediately on error (especially for Go compile errors)
set -e

# bring in some helpful bash assertions
. test-assert.sh

# build our rclone batch executable
go build

# make a temporary directory for the copy destination
TEMPD=$(mktemp -d)
if [ ! -e "$TEMPD" ]; then
    >&2 echo "Failed to create temp directory"
    exit 1
fi

trap 'rm -rf "$TEMPD"' EXIT

#
# test 1 (main case of just copying files)
#

DESTINATION="$TEMPD/test1" ./rclone-batch $RCLONE_BINARY ./testfile1.txt ./testfile2.txt > "$TEMPD/result.json"

# Uncomment to debug invalid result
# cat "$TEMPD/result.json"

assert " find $TEMPD/test1 -type f  | awk 'END{print NR}' " "2"
assert " cat $TEMPD/result.json | jq -r '.\"0\" | .bytes' " "20"
assert " cat $TEMPD/result.json | jq -r '.\"1\" | .bytes' " "21"

rm "$TEMPD/result.json"

#
# test 2 (error cases with one file to fail)
#

DESTINATION="$TEMPD/test2" ./rclone-batch $RCLONE_BINARY ./afilethatdoesnotexist.txt ./testfile2.txt > "$TEMPD/result.json"

# Uncomment to debug invalid result
# cat "$TEMPD/result.json"

assert "find $TEMPD/test2 -type f | awk 'END{print NR}'" "1"
assert " cat $TEMPD/result.json | jq -r '.\"0\" | .lastError' " "directory not found"
assert " cat $TEMPD/result.json | jq -r '.\"0\" | .bytes' " "0"
assert " cat $TEMPD/result.json | jq -r '.\"1\" | .lastError' " "null"
assert " cat $TEMPD/result.json | jq -r '.\"1\" | .bytes' " "21"

rm "$TEMPD/result.json"

#
# test 3 (signal intercept)
#
# this is a test that app will intercept a SIGTERM, pass it to any running rclone process,
# and return sensible results
#

# we set the bandwidth to 1B so that it is slow enough that our TERM signal will come mid-process
# we start this execution in the background
DESTINATION="$TEMPD/test3" DEBUG_BANDWIDTH="1B" ./rclone-batch $RCLONE_BINARY ./testfile1.txt ./testfile2.txt > "$TEMPD/result.json" &

# wait a small amount
sleep 1

# now send a SIGTERM to the launched job
kill %1

# Uncomment to debug invalid result
# cat "$TEMPD/result.json"

assert " cat $TEMPD/result.json | jq -r '.\"0\" | .lastError' " "Interrupted by SIGTERM"
assert " cat $TEMPD/result.json | jq -r '.\"1\" | .lastError' " "Skipped due to SIGTERM received"

rm "$TEMPD/result.json"

#
# end overall testing and set return code
#

assert_end examples
