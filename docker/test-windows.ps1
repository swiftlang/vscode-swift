$env:CI = "1"
$env:FAST_TEST_RUN = "1"
npm ci -ignore-script node-pty
npm run lint
npm run format
npm run package
$Process = Start-Process npm "run integration-test" -Wait -PassThru -NoNewWindow
if ($Process.ExitCode -eq 0) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Process.ExitCode)
    exit 1
}
