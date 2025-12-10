# Install node.js
. .github\workflows\scripts\windows\install-nodejs.ps1

# Download the VSIX archived upstream
npm ci --ignore-scripts
npx tsx scripts/download_vsix.ts
if ($LastExitCode -ne 0) {
    exit $LastExitCode
}
