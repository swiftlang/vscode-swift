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
npm ci -ignore-script node-pty
npm run lint
npm run format
npm run package
$User_Directory=".vscode-test\user-data\User"
New-Item $User_Directory -type directory -force
$Settings = @'
{
    "swift.buildArguments": ["-Xswiftc", "-visualc-tools-version", "-Xswiftc", "14.42.34433", "-Xswiftc", "-windows-sdk-version", "-Xswiftc", "10.0.22000.0"]
}
'@
$Settings | Set-Content "$User_Directory\settings.json"
$Process = Start-Process npm "run integration-test" -Wait -PassThru -NoNewWindow
if ($Process.ExitCode -eq 0) {
    Write-Host 'SUCCESS'
} else {
    Write-Host  ('FAILED ({0})' -f $Process.ExitCode)
    exit 1
}
