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

// NOTE: we use a prefix of RB (rclone-batch) just so we don't accidentally clash with a real
// env variable that has meaning to rclone (for example)
const rcloneBinaryEnvName = "RB_RCLONE_BINARY"
const destinationEnvName = "RB_DESTINATION"

/**
 * A ternaryish operator
 */
func If[T any](cond bool, vtrue, vfalse T) T {
	if cond {
		return vtrue
	}
	return vfalse
}

/**
 * A command line wrapper for invoking rclone one by one and return stats/error messages
 * to the parent caller. Finishes by sending the stats back to the AWS parent task if asked.
 *
 * Inputs
 *   os.Args the source object paths to copy (rclone syntax e.g s3:bucket:key)
 * Env
 *  RB_RCLONE_BINARY the path to an rclone binary to use
 *  RB_DESTINATION the path to send the objects (rclone syntax e.g s3:bucket:key)
 *  RB_TASK_TOKEN if present, the task token to use to send the copy results back to the parent
 *  RB_DEBUG_BANDWIDTH if present, a rclone bandwidth setting (just for debug/testing)
 *  ...any other rclone settings needed...
 *  RCLONE_CONFIG_S3_PROVIDER...
 */
func main() {
	// NOTE: if this was a traditional command line tool we would take these in as command
	// line parameters. However, we are invoking this as an ECS Task and it turns out easier
	// to pass these down via environment variables - saving the command line args *only* for the list
	// of files we want to copy

	rcloneBinary, rcloneBinaryOk := os.LookupEnv(rcloneBinaryEnvName)

	if !rcloneBinaryOk {
		log.Fatalf("No environment variable %s telling us the path to an rclone executable", rcloneBinaryEnvName)
	}

	if !strings.Contains(rcloneBinary, "rclone") {
		// given we are a program that executes another program - just a little sanity check that what we
		// are invoking vaguely makes sense
		// (feel free to remove this if you have a use case where the binary is named otherwise)
		log.Fatalf("The environment variable %s should have the string rclone in it somewhere", rcloneBinaryEnvName)
	}

	destination, destinationOk := os.LookupEnv(destinationEnvName)

	if !destinationOk {
		log.Fatalf("No environment variable %s telling us where to copy the objects", destinationEnvName)
	}

	// a task token that ECS/Steps can pass us so we can return data
	taskToken, taskTokenOk := os.LookupEnv("RB_TASK_TOKEN")

    // now that we know whether we want to use the task token - we will definitely need AWS config to work
    // - so no need starting copying if we will fail at the end
    cfg, cfgErr := config.LoadDefaultConfig(context.TODO())

    if taskTokenOk {
        if cfgErr != nil {
            log.Fatalf("Unable to load AWS config, %v", cfgErr)
        }
    }

	// special environment variables that we can use for some debug/testing
	debugBandwidth, debugBandwidthOk := os.LookupEnv("RB_DEBUG_BANDWIDTH")

	// we end up with a result array entry for each object we have been asked to copy
	results := make([]any, len(os.Args)-1)

	signalChannel := make(chan os.Signal)

	// set as soon as we receive a SIGTERM - so that we will then just quickly skip the rest of the files
	interrupted := false

	for i := 1; i < len(os.Args); i++ {

		// what we are processing in this iteration
		which := i - 1
		source := os.Args[i]

		log.Printf("Asked to copy %s as the %d object to copy", source, which)

		if !interrupted {
			// setup an rclone copy with capture stats (noting that stats are sent to stderr)
			cmd := exec.Command(rcloneBinary,
				"--use-json-log",
				"--stats-log-level", "NOTICE",
				"--stats-one-line",
				// only display stats at the end (after 10000 hours)
				"--stats", "10000h",
				// normally no bandwidth limiting ("0") - but can institute bandwidth limit if asked
				"--bwlimit", If(debugBandwidthOk, debugBandwidth, "0"),
				"copy", source, destination)

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
				log.Printf("rclone Run() failed with %v", err)
				results[which] = map[string]any{
					"lastError":   "Interrupted by SIGTERM",
					"systemError": fmt.Sprintf("%v", err),
					"source":      source}
			} else {
				log.Printf("rclone Run() succeeded")
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
						// insert information about the file we were copying
						statsValue["source"] = source
						results[which] = statsValue
					}
				}
			}
		} else {
			results[which] = map[string]any{
				"lastError": "Skipped due to SIGTERM received",
				"source":    source}
		}
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

		// output
		// The JSON output of the task. Length constraints apply to the payload size, and are expressed as bytes in UTF-8 encoding.
		// Type: String
		// Length Constraints: Maximum length of 262144.
		sfnSvc.SendTaskSuccess(context.TODO(), &sfn.SendTaskSuccessInput{
			Output:    aws.String(resultsString),
			TaskToken: aws.String(taskToken),
		})
	} else {
		// if no task token was given then we just print the results
		fmt.Println(resultsString)
	}
}
