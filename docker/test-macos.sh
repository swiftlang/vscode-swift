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

set -e

platform=$([ "$(arch)" == "arm64" ] && echo "arm64" || echo "x64")

NODE_VERSION="$(cat .nvmrc)"
NODE_NAME="node-v$NODE_VERSION-darwin-$platform"
NODE_ARCHIVE="$NODE_NAME.tar.gz"
ARTIFACTS="$PWD/.vscode-test"
USER_DATA="$PWD/ud"
VSCODE_SETTINGS="$USER_DATA/User/settings.json"
LSP_SETTINGS="$HOME/.sourcekit-lsp/config.json"

export TMPDIR="$ARTIFACTS/tmp"
export TMP="$TMPDIR"
mkdir -p "$TMPDIR"

function cleanup {
    rm SHASUMS256.txt
    rm "$NODE_ARCHIVE"
    rm -rf "$ARTIFACTS"
    rm -rf "$LSP_SETTINGS"
    rm -rf "$USER_DATA"
}
trap "cleanup" EXIT
trap "cleanup" INT

curl -O "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE"
curl -O "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"

grep "$NODE_ARCHIVE" SHASUMS256.txt | shasum -a 256 -c -

tar -xzf "$NODE_ARCHIVE" -C "$ARTIFACTS"

export NPM_CONFIG_CACHE="$ARTIFACTS/$NODE_NAME/cache"
export NPM_CONFIG_PREFIX="$ARTIFACTS/$NODE_NAME"
export NPM_CONFIG_USERCONFIG="$ARTIFACTS/$NODE_NAME/usernpmrc"
export NPM_CONFIG_GLOBALCONFIG="$ARTIFACTS/$NODE_NAME/globalnpmrc"

PATH="$ARTIFACTS/$NODE_NAME/bin:$PATH"

mkdir -p "$(dirname "$VSCODE_SETTINGS")"
cat <<EOT > "$VSCODE_SETTINGS"
{
    "swift.path": "/Users/ec2-user/jenkins/workspace/pr-vscode-swift-macos/branch-main/latest_toolchain/usr/bin"
    "swift.disableSandbox": true,
    "swift.debugger.disable": true,
    "swift.debugger.path": "/Users/ec2-user/jenkins/workspace/pr-vscode-swift-macos/branch-main/latest_toolchain/usr/bin/lldb-dap",
    "lldb.library": "/Applications/Xcode-beta.app/Contents/SharedFrameworks/LLDB.framework/Versions/A/LLDB",
    "lldb.launch.expressions": "native",
    "lldb.suppressUpdateNotifications": true
}
EOT

mkdir -p "$(dirname "$LSP_SETTINGS")"
cat <<EOT > "$LSP_SETTINGS"
{
    "swiftPM": {
        "disableSandbox": true,
        "swiftCompilerFlags": [
            "-disable-sandbox"
        ]
    }
}
EOT

npm ci -ignore-script node-pty
npm run lint
npm run format
npm run package

# Ignore hooks when running locally for development
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="core.hookspath"
export GIT_CONFIG_VALUE_0="$PWD/hooks"

# Need to set proxy to download VS Code
export npm_config_https_proxy="$HTTPS_PROXY"

# export DEVELOPER_DIR=/Applications/Xcode-beta.app
VSCODE_DATA_DIR="$USER_DATA" CI=1 FAST_TEST_RUN=1 npm run coverage -- --coverage-output "$PWD/coverage"