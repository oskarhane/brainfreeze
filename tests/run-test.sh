#!/bin/bash
# Helper script to run tests with test environment

set -e

# Load test environment
if [ -f .env.test ]; then
  export $(cat .env.test | grep -v '^#' | xargs)
fi

# Run the test script passed as argument
if [ -z "$1" ]; then
  echo "Usage: ./tests/run-test.sh <test-script.sh>"
  exit 1
fi

bash "$1"
