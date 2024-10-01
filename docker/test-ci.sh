#!/usr/bin/env node

const { execSync } = require('child_process');

// Default to 'ci' if no argument is provided
const job = (process.argv[2] || 'ci')

// Default to 'main' if no argument is provided
const swiftVersion = (process.argv[3] || 'main').replace(/\./g, '');

const baseConfigFile = job === 'ci' ? 'docker-compose.yaml' : 'docker-compose-nightly.yaml'
const command = `docker compose -f docker/${baseConfigFile} -f docker/docker-compose.*.${swiftVersion}.yaml -p swift-vscode-${swiftVersion}-prb run --rm test`;

console.log(`Running: ${command}`);
execSync(command, { stdio: 'inherit' });