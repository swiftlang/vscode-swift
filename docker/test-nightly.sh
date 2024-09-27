#!/usr/bin/env node

const { execSync } = require('child_process');

// Default to 'main' if no argument is provided
const swiftVersion = (process.argv[2] || 'main').replace(/\./g, '');
const command = `docker compose -f docker/docker-compose-nightly.yaml -f docker/docker-compose.*.${swiftVersion}.yaml -p swift-vscode-${swiftVersion}-prb run --rm test`;

console.log(`Running: ${command}`);
execSync(command, { stdio: 'inherit' });