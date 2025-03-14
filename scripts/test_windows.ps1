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

$env:VCToolsVersion = "14.43.34808"
$env:VCToolsInstallDir = "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Tools\MSVC\14.43.34808"

Get-ChildItem Env:

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
