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

export NODE_VERSION=v20.19.0
export NVM_DIR="$RUNNER_TEMP/.nvm"
export NODE_PATH="$NVM_DIR/versions/node/v20.19.0/bin"

mkdir -p "$NVM_DIR"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" && nvm install $NODE_VERSION
echo "$NODE_PATH" >> "$GITHUB_PATH"

env | sort

if [ -n "$VSCODE_SWIFT_VSIX_ID" ]; then
    npm ci --ignore-scripts
    npx tsx scripts/download_vsix.ts
fi

automationmodetool