#!/bin/bash
##===----------------------------------------------------------------------===##
##
## This source file is part of the VS Code Swift open source project
##
## Copyright (c) 2021 the VS Code Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VS Code Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##

set -ex

current_directory=$(pwd)

mkdir /tmp/code
# Add the -v flag to see what is getting copied in to the working folder
rsync -a --exclude "node_modules" \
    --exclude "out" \
    --exclude "dist" \
    --exclude ".git" \
    --exclude ".vscode-test" \
    --exclude ".build" \
    ./ /tmp/code/
cd /tmp/code

npm ci
npm run lint
npm run format
npm run package
npm run test-soundness -- --force-run

xvfb-run -a npm run coverage 2>&1 | grep -Ev "Failed to connect to the bus|GPU stall due to ReadPixels"
exit_code=${PIPESTATUS[0]}

rm -rf "${current_directory}/coverage"
cp -R ./coverage "${current_directory}" || true

exit "${exit_code}"
