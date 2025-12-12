$NODEJS='https://nodejs.org/dist/v22.21.1/node-v22.21.1-x64.msi'
$NODEJS_SHA256='fd7a63fec3a54a665851e2d3d93e07cfead2ffb4521675ffdbceb1bb5ac009bb'
Set-Variable ErrorActionPreference Stop
Set-Variable ProgressPreference SilentlyContinue
Write-Host -NoNewLine ('Downloading {0} ... ' -f ${NODEJS})
Invoke-WebRequest -Uri ${NODEJS} -OutFile  $env:TEMP\node.msi
Write-Host 'SUCCESS'
Write-Host -NoNewLine ('Verifying SHA256 ({0}) ... ' -f ${NODEJS_SHA256})
$Hash = Get-FileHash $env:TEMP\node.msi -Algorithm sha256
if ($Hash.Hash -eq ${NODEJS_SHA256}) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Hash.Hash)
    exit 1
}
Write-Host -NoNewLine 'Installing node.js for Windows ... '
$Process = Start-Process msiexec "/i  $env:TEMP\node.msi /norestart /qn" -Wait -PassThru
if ($Process.ExitCode -eq 0) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Process.ExitCode)
    exit 1
}
Remove-Item -Force $env:TEMP\node.msi
