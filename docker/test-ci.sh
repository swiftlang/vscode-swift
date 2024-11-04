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

node << 'EOF'
const { execSync } = require('child_process');

// Default to 'ci' if no argument is provided
const job = (process.argv[2] || 'ci')

// Default to 'main' if no argument is provided
const swiftVersion = (process.argv[3] || 'main').replace(/\./g, '');

const baseConfigFile = job === 'ci' ? 'docker-compose.yaml' : 'docker-compose-nightly.yaml'
const command = `docker compose -f docker/${baseConfigFile} -f docker/docker-compose.*.${swiftVersion}.yaml -p swift-vscode-${swiftVersion}-prb run --rm -T test`;

console.log(`Running: ${command}`);
execSync(command, { stdio: 'inherit' });
EOF