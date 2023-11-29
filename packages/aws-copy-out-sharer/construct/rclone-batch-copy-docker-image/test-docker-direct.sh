#!/bin/bash

# we want to exit immediately on error (especially for Go/Docker build errors)
set -e

docker build . -t rclone-batch

docker run rclone-batch -e DESTINATION=/tmp
