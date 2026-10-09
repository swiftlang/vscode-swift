#!/bin/bash
##===----------------------------------------------------------------------===##
##
## This source file is part of the VS Code Swift open source project
##
## Copyright (c) 2025 the VS Code Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VS Code Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##

set -ex

export NODE_OPTIONS="--dns-result-order=ipv4first"
export npm_config_http_proxy="$HTTP_PROXY"
export npm_config_https_proxy="$HTTPS_PROXY"
export VSCODE_DATA_DIR="$RUNNER_TEMP/ud"

# Dump the VS Code logs on the way out so a launch that hangs or crashes
# leaves something to look at.
dump_vscode_logs() {
    set +x
    find "$VSCODE_DATA_DIR/logs" -name "*.log" 2>/dev/null | while read -r log; do
        echo "::group::$log"
        cat "$log"
        echo "::endgroup::"
    done
}
trap dump_vscode_logs EXIT

npm ci
npm run lint
npm run format
npm run pretest

# macOS has no timeout(1), so run the tests in their own process group and
# kill the whole group, VS Code included, if they run past the limit. Grab the
# process tree first so there's a record of the hang.
VSCODE_TEST_TIMEOUT="${VSCODE_TEST_TIMEOUT:-300}"
set -m
npx vscode-test --coverage &
test_pid=$!
(
    sleep "$VSCODE_TEST_TIMEOUT"
    echo "::error::VS Code tests timed out after ${VSCODE_TEST_TIMEOUT}s"
    echo "::group::Running processes"
    ps -axo pid,ppid,pgid,stat,etime,command || true
    echo "::endgroup::"
    kill -TERM -- "-$test_pid" || true
    sleep 10
    kill -KILL -- "-$test_pid" 2>/dev/null || true
) &
watchdog_pid=$!
set +m

test_status=0
wait "$test_pid" || test_status=$?
kill -- "-$watchdog_pid" 2>/dev/null || true
exit "$test_status"
