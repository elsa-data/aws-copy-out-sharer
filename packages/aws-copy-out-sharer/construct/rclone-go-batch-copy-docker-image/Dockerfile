FROM golang:1.21-alpine as builder

RUN apk add --no-cache git

WORKDIR /build

RUN go env -w GOPROXY=direct

ADD go.mod go.sum ./

RUN go mod download

ADD main.go ./

RUN env GOOS=linux CGO_ENABLED=0 GOARCH=amd64 go build


FROM rclone/rclone:1.64.2

# if we want signals to propogate through to the app we need a lightweight initd
RUN apk add --no-cache tini

# this is where rclone binary ends up by default so we will do our work there
WORKDIR /data

COPY --from=builder /build/rclone-batch ./

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/rclone-batch"]
