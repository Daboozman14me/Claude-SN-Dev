#!/usr/bin/env bash
# Copies this case's fixtures into the eval workspace (npm run evals does this itself; kept so the
# suite also runs under `claude plugin eval --scaffold`).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixtures/." .
