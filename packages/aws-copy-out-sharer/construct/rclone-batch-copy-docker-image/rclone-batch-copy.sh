
# If you are familiar with rsync, rclone always works
# as if you had written a trailing / - meaning "copy the
# contents of this directory". This applies to all commands
# and whether you are talking about the source or destination.

echo "Destination = $destination"
echo "Task token = $tasktoken"

for src in "$@"; do
  echo "Source arg = $src"
  /usr/local/bin/rclone copy --stats-log-level NOTICE --checksum "$src" "$destination"
done

aws stepfunctions send-task-success --task-token "$tasktoken" --task-output '{ "0": "OK", "1": "OK" }'
