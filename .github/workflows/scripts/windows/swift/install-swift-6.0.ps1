$SWIFT='https://download.swift.org/swift-6.0.2-release/windows10/swift-6.0.2-RELEASE/swift-6.0.2-RELEASE-windows10.exe'
$SWIFT_SHA256='516FE8E64713BD92F03C01E5198011B74A27F8C1C88627607A2F421718636126'
Write-Host -NoNewLine ('Downloading {0} ... ' -f $SWIFT)
Invoke-WebRequest -Uri $SWIFT -OutFile installer.exe
Write-Host 'SUCCESS'
Write-Host -NoNewLine ('Verifying SHA256 ({0}) ... ' -f $SWIFT_SHA256)
$Hash = Get-FileHash installer.exe -Algorithm sha256
if ($Hash.Hash -eq $SWIFT_SHA256) {
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
