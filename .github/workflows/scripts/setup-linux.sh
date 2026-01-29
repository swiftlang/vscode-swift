#!/bin/bash
##===----------------------------------------------------------------------===##
##
## This source file is part of the VS Code Swift open source project
##
## Copyright (c) 2024 the VS Code Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VS Code Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##

NVMRC_VERSION=$(cat .nvmrc)
export NVMRC_VERSION
export NODE_VERSION="v${NVMRC_VERSION}"
export NODE_PATH=/usr/local/nvm/versions/node/${NODE_VERSION}/bin
export NVM_DIR=/usr/local/nvm

apt-get update && apt-get install -y rsync curl gpg libasound2 libgbm1 libgtk-3-0 libnss3 xvfb build-essential
mkdir -p $NVM_DIR
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# shellcheck disable=SC1091
. $NVM_DIR/nvm.sh && nvm install "$NODE_VERSION"
echo "$NODE_PATH" >> "$GITHUB_PATH"

env | sort

if [ -n "$VSCODE_SWIFT_VSIX_ID" ]; then
    npm ci --ignore-scripts
    npx tsx scripts/download_vsix.ts
fi

echo "version=${NODE_VERSION}" >> "$GITHUB_OUTPUT"
echo "path=/usr/local/nvm/versions/node/${NODE_VERSION}/bin" >> "$GITHUB_OUTPUT"
nvm install
nvm use
npm ci
