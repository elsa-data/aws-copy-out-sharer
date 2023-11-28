FROM rclone/rclone:1.64.2

RUN apk add --no-cache aws-cli tini

# a shell script that allows us to take more batch like input to rclone
COPY rclone-batch-copy.sh /app/

ENTRYPOINT ["/sbin/tini", "--", "/bin/sh", "/app/rclone-batch-copy.sh"]
