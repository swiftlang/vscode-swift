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

automationmodetool

npm ci -ignore-script node-pty
npm run lint
npm run format
npm run coverage

exit "$?"
