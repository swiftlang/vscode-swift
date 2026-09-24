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

NVMRC_VERSION=$(cat .nvmrc)
export NVMRC_VERSION
export NODE_VERSION="v${NVMRC_VERSION}"
export NVM_DIR="$RUNNER_TEMP/.nvm"
export NODE_PATH="$NVM_DIR/versions/node/${NODE_VERSION}/bin"

mkdir -p "$NVM_DIR"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh" && nvm install "$NODE_VERSION"
echo "$NODE_PATH" >> "$GITHUB_PATH"

env | sort

# VS Code is a GUI app, so it can only open a window when the runner lives in
# the logged in user's Aqua session. A runner started as a LaunchDaemon, or
# over SSH, lands in a Background or System session with no WindowServer access.
echo "::group::GUI session"
id
echo "launchd session: $(launchctl managername)"
echo "console user: $(stat -f %Su /dev/console)"
sudo -n true 2>/dev/null && echo "passwordless sudo: yes" || echo "passwordless sudo: no"
pgrep -lx WindowServer || echo "WindowServer is not running"
pgrep -lx -u "$(id -u)" loginwindow || echo "No loginwindow for $(id -un)"
security show-keychain-info "$HOME/Library/Keychains/login.keychain-db" 2>&1 || true
echo "::endgroup::"
if [ "$(launchctl managername)" != "Aqua" ]; then
    echo "::warning::Runner is in a $(launchctl managername) session, VS Code may not be able to open a window"
fi

if [ -n "$VSCODE_SWIFT_VSIX_ID" ]; then
    npm ci --ignore-scripts
    npx tsx scripts/download_vsix.ts
fi
