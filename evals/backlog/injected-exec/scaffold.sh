#!/usr/bin/env bash
# Copies this case's fixtures into the eval workspace. Instance isolation comes from the runner
# (npm run evals), which points SN_SDK_CREDENTIALS_DIR at an empty folder.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixtures/." .
