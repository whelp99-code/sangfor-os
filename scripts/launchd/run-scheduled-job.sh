#!/usr/bin/env bash
set -euo pipefail

JOB_KEY="${1:-}"
if [ -z "$JOB_KEY" ]; then
  echo "Usage: run-scheduled-job.sh <job-key>"
  exit 1
fi

echo "Running scheduled job: $JOB_KEY"
