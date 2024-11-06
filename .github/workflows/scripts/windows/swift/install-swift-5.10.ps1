. $PSScriptRoot\install-swift.ps1

$SWIFT='https://download.swift.org/swift-5.10.1-release/windows10/swift-5.10.1-RELEASE/swift-5.10.1-RELEASE-windows10.exe'
$SWIFT_SHA256='3027762138ACFA1BBE3050FF6613BBE754332E84C9EFA5C23984646009297286'

Install-Swift -Url $SWIFT -Sha256 $SWIFT_SHA256
