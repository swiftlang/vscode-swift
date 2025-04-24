# Install node.js
. .github\workflows\scripts\windows\install-nodejs.ps1

# Download the VSIX archived upstream
npm ci -ignore-script node-pty
$Process = Start-Process npx "tsx scripts/download_vsix.ts" -Wait -PassThru -NoNewWindow
if ($Process.ExitCode -eq 0) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Process.ExitCode)
    exit 1
}
