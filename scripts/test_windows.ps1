##===----------------------------------------------------------------------===##
##
## This source file is part of the VS Code Swift open source project
##
## Copyright (c) 2025 the VS Code Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VS Code Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##

$env:CI = "1"
$env:FAST_TEST_RUN = "1"

Get-ChildItem -Path "C:\Program Files\"
Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio"
Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022\"
Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022\Enterprise"
Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\"
Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\"
Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC\"
Get-ChildItem -Path "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC\14.43.34808"

Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin"

# There are two versions of Visual C++ tools installed on the machine running the GH action:
# - 14.29.30133
# - 14.43.34808
# Use the 14.43.34808 version.

$env:VCToolsVersion = "14.43.34808"
$env:VCToolsInstallDir = "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC\14.43.34808"

Get-ChildItem Env:

$jsonFilePath = "./assets/test/.vscode/settings.json"
$jsonContent = Get-Content -Raw -Path $jsonFilePath | ConvertFrom-Json
$jsonContent | Add-Member -MemberType NoteProperty -Name "swift.buildArguments" -Value @("-Xbuild-tools-swiftc", "-windows-sdk-root", "-Xbuild-tools-swiftc", "C:\Program Files (x86)\Windows Kits\10\", "-Xbuild-tools-swiftc", "-windows-sdk-version", "-Xbuild-tools-swiftc", "10.0.22000.0", "-Xbuild-tools-swiftc", "-visualc-tools-version", "-Xbuild-tools-swiftc", "14.43.34808", "-Xswiftc", "-windows-sdk-root", "-Xswiftc", "C:\Program Files (x86)\Windows Kits\10\", "-Xswiftc", "-windows-sdk-version", "-Xswiftc", "10.0.22000.0", "-Xswiftc", "-visualc-tools-version", "-Xswiftc", "14.43.34808")
$jsonContent | Add-Member -MemberType NoteProperty -Name "swift.packageArguments" -Value @("-Xbuild-tools-swiftc", "-windows-sdk-root", "-Xbuild-tools-swiftc", "C:\Program Files (x86)\Windows Kits\10\", "-Xbuild-tools-swiftc", "-windows-sdk-version", "-Xbuild-tools-swiftc", "10.0.22000.0", "-Xbuild-tools-swiftc", "-visualc-tools-version", "-Xbuild-tools-swiftc", "14.43.34808", "-Xswiftc", "-windows-sdk-root", "-Xswiftc", "C:\Program Files (x86)\Windows Kits\10\", "-Xswiftc", "-windows-sdk-version", "-Xswiftc", "10.0.22000.0", "-Xswiftc", "-visualc-tools-version", "-Xswiftc", "14.43.34808")
$jsonContent | ConvertTo-Json -Depth 32 | Set-Content -Path $jsonFilePath

Write-Host "Contents of ${jsonFilePath}:"
Get-Content -Path $jsonFilePath

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
