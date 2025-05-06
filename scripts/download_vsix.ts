//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
/* eslint-disable no-console */

import decompress from "decompress";
import { createWriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Octokit } from "octokit";

const artifact_id = process.env["VSCODE_SWIFT_VSIX_ID"];
if (!artifact_id) {
    console.error("No VSCODE_SWIFT_VSIX_ID provided");
    process.exit(0);
}
const token = process.env["GITHUB_TOKEN"];
if (!token) {
    console.error("No GITHUB_TOKEN provided");
    process.exit(1);
}
const repository = process.env["GITHUB_REPOSITORY"] || "swiftlang/vscode-swift";
const owner = repository.split("/")[0];
const repo = repository.split("/")[1];

(async function () {
    const octokit = new Octokit({
        auth: token,
    });

    const { data } = await octokit.request(
        `GET /repos/${repository}/actions/artifacts/${artifact_id}/zip`,
        {
            request: {
                parseSuccessResponseBody: false,
            },
            owner,
            repo,
            artifact_id,
            archive_format: "zip",
            headers: {
                "X-GitHub-Api-Version": "2022-11-28",
            },
        }
    );
    await pipeline(data, createWriteStream("artifacts.zip", data));
    const files = await decompress("artifacts.zip", process.cwd());
    console.log(`Downloaded artifact(s): ${files.map(f => f.path).join(", ")}`);
    const newName = process.env["VSCODE_SWIFT_VSIX"] || "vscode-swift.vsix";
    const releaseVSIX = files.find(f => /swift-vscode-\d.\d.\d-\d+.vsix/m.test(f.path));
    if (!releaseVSIX) {
        console.error("Cound not find vscode-swift release VSIX in artifact bundle");
        process.exit(1);
    }
    await rename(releaseVSIX.path, newName);
    const prereleaseVSIX = files.find(f => /swift-vscode-\d.\d.\d{8}-\d+.vsix/m.test(f.path));
    if (!prereleaseVSIX) {
        console.error("Cound not find vscode-swift pre-release VSIX in artifact bundle");
        process.exit(1);
    }
    console.log(`Renamed artifact: ${releaseVSIX.path} => ${newName}`);
    const preNewName =
        process.env["VSCODE_SWIFT_PRERELEASE_VSIX"] || "vscode-swift-prerelease.vsix";
    await rename(prereleaseVSIX.path, preNewName);
    console.log(`Renamed artifact: ${prereleaseVSIX.path} => ${preNewName}`);
    await unlink("artifacts.zip");
})();
