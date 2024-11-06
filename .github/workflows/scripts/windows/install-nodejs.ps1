$NODEJS='https://nodejs.org/dist/v18.20.4/node-v18.20.4-x64.msi'
$NODEJS_SHA256='c2654d3557abd59de08474c6dd009b1d358f420b8e4010e4debbf130b1dfb90a'
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