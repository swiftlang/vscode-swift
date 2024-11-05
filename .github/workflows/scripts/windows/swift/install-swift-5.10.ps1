$SWIFT='https://download.swift.org/swift-5.10.1-release/windows10/swift-5.10.1-RELEASE/swift-5.10.1-RELEASE-windows10.exe'
$SWIFT_SHA256='3027762138ACFA1BBE3050FF6613BBE754332E84C9EFA5C23984646009297286'
Write-Host -NoNewLine ('Downloading {0} ... ' -f ${env:SWIFT})
Invoke-WebRequest -Uri ${env:SWIFT} -OutFile installer.exe
Write-Host 'SUCCESS'
Write-Host -NoNewLine ('Verifying SHA256 ({0}) ... ' -f ${env:SWIFT_SHA256})
$Hash = Get-FileHash installer.exe -Algorithm sha256
if ($Hash.Hash -eq ${env:SWIFT_SHA256}) {
    Write-Host 'SUCCESS'
} else {
    Write-Host ('FAILED ({0})' -f $Hash.Hash)
    exit 1
}
Write-Host -NoNewLine 'Installing Swift ... '
$Process = Start-Process installer.exe -Wait -PassThru -NoNewWindow -ArgumentList @(
    '/quiet',
    '/norestart'
)
if ($Process.ExitCode -eq 0) {
    Write-Host 'SUCCESS'
} else {
    Write-Host ('FAILED ({0})' -f $Process.ExitCode)
    exit 1
}
Remove-Item -Force installer.exe
