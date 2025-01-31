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

function Update-SwiftBuildAndPackageArguments {
    param (
        [string]$jsonFilePath = "./assets/test/.vscode/settings.json",
        [string]$windowsSdkVersion = "10.0.22000.0",
        [string]$vcToolsVersion = "14.43.34808"
    )

    $windowsSdkRoot = "C:\Program Files (x86)\Windows Kits\10\"

    try {
        $jsonContent = Get-Content -Raw -Path $jsonFilePath | ConvertFrom-Json
    } catch {
        Write-Host "Invalid JSON content in $jsonFilePath"
        exit 1
    }

    if ($jsonContent.PSObject.Properties['swift.buildArguments']) {
        $jsonContent.PSObject.Properties.Remove('swift.buildArguments')
    }

    $jsonContent | Add-Member -MemberType NoteProperty -Name "swift.buildArguments" -Value @(
        "-Xbuild-tools-swiftc", "-windows-sdk-root", "-Xbuild-tools-swiftc", $windowsSdkRoot,
        "-Xbuild-tools-swiftc", "-windows-sdk-version", "-Xbuild-tools-swiftc", $windowsSdkVersion,
        "-Xbuild-tools-swiftc", "-visualc-tools-version", "-Xbuild-tools-swiftc", $vcToolsVersion,
        "-Xswiftc", "-windows-sdk-root", "-Xswiftc", $windowsSdkRoot,
        "-Xswiftc", "-windows-sdk-version", "-Xswiftc", $windowsSdkVersion,
        "-Xswiftc", "-visualc-tools-version", "-Xswiftc", $vcToolsVersion
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
        "-Xswiftc", "-visualc-tools-version", "-Xswiftc", $vcToolsVersion
    )

    $jsonContent | ConvertTo-Json -Depth 32 | Set-Content -Path $jsonFilePath

    Write-Host "Contents of ${jsonFilePath}:"
    Get-Content -Path $jsonFilePath
}

$swiftVersionOutput = & swift --version
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to execute 'swift --version'"
    exit 1
}

Write-Host "Swift version:"
Write-Host "$swiftVersionOutput"

$versionLine = $swiftVersionOutput[0]
if ($versionLine -match "Swift version (\d+)\.(\d+)") {
    Write-Host "Matched Swift version: $($matches[0]), $($matches[1]), $($matches[2])"

    $majorVersion = [int]$matches[1]
    $minorVersion = [int]$matches[2]

    # In newer Visual C++ Tools they've added compiler intrinsics headers in wchar.h
    # that end up creating a cyclic dependency between the `ucrt` and compiler intrinsics modules.

    # Newer versions of swift (>=6.1) have a fixed modulemap that resolves the issue: https://github.com/swiftlang/swift/pull/79751
    # As a workaround we can pin the tools/SDK versions to older versions that are present in the GH Actions Windows image.
    # In the future we may only want to apply this workaround to older versions of Swift that don't have the fixed module map.
    if ($majorVersion -lt 6 -or ($majorVersion -eq 6 -and $minorVersion -lt 1)) {
        Write-Host "Swift version is < 6.1, injecting windows SDK build arguments"
        Update-SwiftBuildAndPackageArguments
    }
} else {
    Write-Host "Match failed for output: `"$versionLine`""
    Write-Host "Unable to determine Swift version"
    exit 1
}

npm ci -ignore-script node-pty
npm run lint
npm run format
npm run package
npm test -- --label installExtension
npm run test
if ($LASTEXITCODE -eq 0) {
    Write-Host 'SUCCESS'
} else {
    Write-Host ('FAILED ({0})' -f $LASTEXITCODE)
    exit 1
}
