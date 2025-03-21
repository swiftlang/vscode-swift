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

# In newer Visual C++ Tools they've added compiler intrinsics headers in wchar.h
# that end up creating a cyclic dependency between the `ucrt` and compiler intrinsics modules.
# Newer versions of swift (6.2) have a fixed modulemap that resolves the issue: https://github.com/swiftlang/swift/pull/79751
$windowsSdkVersion = "10.0.22000.0"
$vcToolsVersion = "14.43.34808"

# As a workaround we can pin the tools/SDK versions to older versions that are present in the GH Actions Windows image.
# In the future we may only want to apply this workaround to older versions of Swift that don't have the fixed module map.
$jsonFilePath = "./assets/test/.vscode/settings.json"
try {
    $jsonContent = Get-Content -Raw -Path $jsonFilePath | ConvertFrom-Json
} catch {
    Write-Host "Invalid JSON content in $jsonFilePath"
    exit 1
}
if ($jsonContent.PSObject.Properties['swift.buildArguments']) {
    $jsonContent.PSObject.Properties.Remove('swift.buildArguments')
}

$windowsSdkRoot = "C:\Program Files (x86)\Windows Kits\10\"

$jsonContent | Add-Member -MemberType NoteProperty -Name "swift.buildArguments" -Value @(
    "-Xbuild-tools-swiftc", "-windows-sdk-root", "-Xbuild-tools-swiftc", $windowsSdkRoot,
    "-Xbuild-tools-swiftc", "-windows-sdk-version", "-Xbuild-tools-swiftc", $windowsSdkVersion,
    "-Xbuild-tools-swiftc", "-visualc-tools-version", "-Xbuild-tools-swiftc", $vcToolsVersion,
    "-Xswiftc", "-windows-sdk-root", "-Xswiftc", $windowsSdkRoot,
    "-Xswiftc", "-windows-sdk-version", "-Xswiftc", $windowsSdkVersion,
    "-Xswiftc", "-visualc-tools-version", "-Xswiftc", $vcToolsVersion,
    "--very-verbose"
)

if ($jsonContent.PSObject.Properties['swift.packageArguments']) {
    $jsonContent.PSObject.Properties.Remove('swift.packageArguments')
}

$jsonContent | Add-Member -MemberType NoteProperty -Name "swift.packageArguments" -Value @(
    "-Xbuild-tools-swiftc", "-windows-sdk-root", "-Xbuild-tools-swiftc", $windowsSdkRoot,
    "-Xbuild-tools-swiftc", "-windows-sdk-version", "-Xbuild-tools-swiftc", $windowsSdkVersion,
    "-Xbuild-tools-swiftc", "-visualc-tools-version", "-Xbuild-tools-swiftc", $vcToolsVersion,
    "-Xswiftc", "-windows-sdk-root", "-Xswiftc", $windowsSdkRoot,
    "-Xswiftc", "-windows-sdk-version", "-Xswiftc", $windowsSdkVersion,
    "-Xswiftc", "-visualc-tools-version", "-Xswiftc", $vcToolsVersion,
    "--very-verbose"
)

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
