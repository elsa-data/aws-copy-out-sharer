echo "Destination = $destination"

for src in "$@"; do
  echo "Source arg = $src"
  /usr/local/bin/rclone copy --stats-log-level NOTICE --checksum "$src" "$destination"
done
