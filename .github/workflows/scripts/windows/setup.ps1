# Install node.js
. .github\workflows\scripts\windows\install-nodejs.ps1

# Download the VSIX archived upstream
npm ci
$Process = Start-Process npx "tsx scripts/download_vsix.ts" -Wait -PassThru -NoNewWindow
if ($Process.ExitCode -eq 0) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Process.ExitCode)
    exit 1
}

Get-Content $env:GITHUB_ENV | foreach {
    $name, $value = $_.split('=')
    Set-Content env:\$name $value
}
