FROM rclone/rclone:1.63.1

# a shell script that allows us to take more batch like input to rclone
COPY rclone-batch-copy.sh /app/

ENTRYPOINT ["/bin/sh", "/app/rclone-batch-copy.sh"]
