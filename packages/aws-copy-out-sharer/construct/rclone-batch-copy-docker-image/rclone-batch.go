package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sfn"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
)

// retryError:false serverSideCopies:0 serverSideCopyBytes:0 serverSideMoveBytes:0 serverSideMoves:0 speed:0 totalChecks:0 totalTransfers:1 transferTime:0.000586292 transfers:1
type RcloneStats struct {
	Bytes       int     `json:"bytes"`
	Checks      int     `json:"checks"`
	ElapsedTime float64 `json:"elapsedTime"`
	Errors      int     `json:"errors"`
	LastError   string  `json:"lastError"`
	FatalError  bool    `json:"fatalError"`
	TotalBytes  int     `json:"totalBytes"`
}

func If[T any](cond bool, vtrue, vfalse T) T {
	if cond {
		return vtrue
	}
	return vfalse
}

func main() {
	cfg, err := config.LoadDefaultConfig(context.TODO())

	if err != nil {
		log.Fatalf("unable to load AWS config, %v", err)
	}

	// NOTE: if this was a traditional command line tool we would take these in as command
	// line parameters. However, we are invoking this as an ECS Task and it turns out easier
	// to pass these down via environment variables - saving the command line *only* for the list
	// of files we want to copy
	destination, destinationOk := os.LookupEnv("DESTINATION")

	if !destinationOk {
		log.Fatalf("No environment variable DESTINATION telling us where to copy the objects", err)
	}

	taskToken, taskTokenOk := os.LookupEnv("TASK_TOKEN")

	// special environment variables that we can use for some debug/testing
	debugBandwidth, debugBandwidthOk := os.LookupEnv("DEBUG_BANDWIDTH")

	results := make(map[int]any)

	signalChannel := make(chan os.Signal)

    // set as soon as we receive a SIGTERM - so that we will then just quickly skip the rest of the files
	interrupted := false

	for i := 2; i < len(os.Args); i++ {
		if !interrupted {
			// setup an rclone copy with capture stats (noting that stats are sent to stderr)
			cmd := exec.Command(os.Args[1],
				"--use-json-log",
				"--stats-log-level", "NOTICE",
				"--stats-one-line",
				// only display stats at the end (after 10000 hours)
				"--stats", "10000h",
				// normally no bandwidth limiting ("0") - but can institute bandwidth limit if asked
				"--bwlimit", If(debugBandwidthOk, debugBandwidth, "0"),
				"copy", os.Args[i], destination)

            // we are only interested in stderr
			stderrStringBuilder := new(strings.Builder)
			cmd.Stderr = stderrStringBuilder

            // we need to be able handling getting a SIGTERM when AWS wants to reclaim our SPOT instance
            signal.Notify(signalChannel, os.Interrupt, syscall.SIGTERM)
            go func() {
                sig := <-signalChannel
                switch sig {
                case syscall.SIGTERM:
                    // terminate the currently running rclone
                    cmd.Process.Signal(syscall.SIGTERM)
                    // indicate we don't want future rclones to run
                    interrupted = true
                }
            }()

			err := cmd.Run()

			if err != nil {
				results[i-2] = map[string]any{"lastError": "Interrupted by SIGTERM", "systemError": err}
			}

			// each line of stderr output is stats in JSON format or possibly other random messages
			stderrStringLines := strings.Split(strings.TrimSuffix(stderrStringBuilder.String(), "\n"), "\n")

			// attempt to process each line of log output to stderr as JSON (if not then ignore)
			for _, line := range stderrStringLines {
				var logLineJson map[string]any

				logLineJsonErr := json.Unmarshal([]byte(line), &logLineJson)

				if logLineJsonErr == nil {

					statsValue, statsOk := logLineJson["stats"].(map[string]any)

					if statsOk {
						results[i-2] = statsValue
					}
				}
			}
		} else {
			results[i-2] = map[string]any{"lastError": "Skipped due to SIGTERM received"}
		}

		// if asked we sleep for delay after seconds (this gives the outer environment
		// time to send us a SIGINT etc)
		/*if debugDelayAfterOk {
			debugDelayAfterFloat, err := strconv.ParseFloat(debugDelayAfter, 64)
			if err == nil {
				time.Sleep(time.Duration(debugDelayAfterFloat) * time.Second)
			}
		} */

	}

	resultsJson, err := json.MarshalIndent(results, "", "  ")

	if err != nil {
		log.Fatalf("Could not marshall the rclone outputs to JSON", err)
	}

	resultsString := string(resultsJson)

	// the normal mechanism by which we will send back results to our caller is
	// Steps SendTask - which sends back JSON
	if taskTokenOk {
		sfnSvc := sfn.NewFromConfig(cfg)

		sfnSvc.SendTaskSuccess(context.TODO(), &sfn.SendTaskSuccessInput{
			Output:    aws.String(resultsString),
			TaskToken: aws.String(taskToken),
		})

		fmt.Println(taskToken)
	} else {
		// if no task token was given then we just print the results
		fmt.Println(resultsString)
	}
}
