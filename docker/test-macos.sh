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

NODE_VERSION="$(cat .nvmrc)"
NODE_NAME="node-v$NODE_VERSION-darwin-arm64"
NODE_ARCHIVE="$NODE_NAME.tar.gz"
ARTIFACTS="$PWD/.vscode-test"
VSCODE_SETTINGS="$ARTIFACTS/user-data/User/settings.json"
LSP_SETTINGS="$HOME/.sourcekit-lsp/config.json"

export TMPDIR="$ARTIFACTS/tmp"
mkdir -p $TMPDIR

function cleanup {
    rm SHASUMS256.txt
    rm $NODE_ARCHIVE
    rm -rf "$ARTIFACTS"
    rm -rf "$LSP_SETTINGS"
}
trap "cleanup" EXIT

curl -O "https://nodejs.org/dist/v$NODE_VERSION/$NODE_ARCHIVE"
curl -O "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"

NODE_CHECKSUM="$(grep $NODE_ARCHIVE SHASUMS256.txt)"

grep "$NODE_ARCHIVE" SHASUMS256.txt | sha256sum -c -

tar -xzf $NODE_ARCHIVE -C $ARTIFACTS

export NPM_CONFIG_CACHE="$ARTIFACTS/$NODE_NAME/cache"
export NPM_CONFIG_PREFIX="$ARTIFACTS/$NODE_NAME"
export NPM_CONFIG_USERCONFIG="$ARTIFACTS/$NODE_NAME/usernpmrc"
export NPM_CONFIG_GLOBALCONFIG="$ARTIFACTS/$NODE_NAME/globalnpmrc"

PATH="$ARTIFACTS/$NODE_NAME/bin:$PATH"

mkdir -p $(dirname "$VSCODE_SETTINGS")
cat <<EOT > $VSCODE_SETTINGS
{
    "swift.buildArguments": [
        "--disable-sandbox",
        "-Xswiftc",
        "-disable-sandbox"
    ]
}
EOT

mkdir -p $(dirname "$LSP_SETTINGS")
cat <<EOT > $LSP_SETTINGS
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
FAST_TEST_RUN=1 npm run coverage -- --coverage-output "$PWD/coverage"