# Install node.js
. .github\workflows\scripts\windows\install-nodejs.ps1

# Download the VSIX archived upstream
npm ci -ignore-script node-pty
npx tsx scripts/download_vsix.ts