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

export NODE_VERSION=v20.18.2
export NODE_PATH=/usr/local/nvm/versions/node/v20.18.2/bin
export NVM_DIR=/usr/local/nvm

apt-get update && apt-get install -y rsync curl gpg libasound2 libgbm1 libgtk-3-0 libnss3 xvfb build-essential

if [ ! -z "$VSCODE_SWIFT_VSIX_URL" ]; then
    export VSCODE_SWIFT_VSIX="$PWD/vscode-swift.vsix"
    echo "Downloading $VSCODE_SWIFT_VSIX_URL to $VSCODE_SWIFT_VSIX"
    curl -o $VSCODE_SWIFT_VSIX "$VSCODE_SWIFT_VSIX_URL" 
fi

mkdir -p $NVM_DIR
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
/bin/bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION"
echo "$NODE_PATH" >> "$GITHUB_PATH"