. $PSScriptRoot\install-swift.ps1

$SWIFT='https://download.swift.org/swift-5.9.2-release/windows10/swift-5.9.2-RELEASE/swift-5.9.2-RELEASE-windows10.exe'
$SWIFT_SHA256='D78A717551C78E824C9B74B0CFB1AD86060FC286EA071FDDB26DF18F56DC7212'

Install-Swift -Url $SWIFT -Sha256 $SWIFT_SHA256