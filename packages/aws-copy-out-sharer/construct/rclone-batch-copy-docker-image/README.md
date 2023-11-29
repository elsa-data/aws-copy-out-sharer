# rclone-batch

`rclone-batch` is a Go wrapper around the invocation of `rclone`. Why do we need
a wrapper? Well we want to get the statistics output of `rclone` in a way
that we can standardise. Also, we want optionally to be able to send this info
back to the parent AWS ECS task. Furthermore, there are aspects of signal
handling that we want to support for AWS Spot that is not quite the same as
`rclone` out of the box.
