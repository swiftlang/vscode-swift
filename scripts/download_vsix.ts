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
import { appendFile, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Octokit } from "octokit";
import { main } from "./lib/utilities";

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
const envFile = process.env["GITHUB_ENV"];
if (!envFile) {
    console.error("No GITHUB_ENV provided");
    process.exit(1);
}
const repository = process.env["GITHUB_REPOSITORY"] || "swiftlang/vscode-swift";
const owner = repository.split("/")[0];
const repo = repository.split("/")[1];

main(async function () {
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
    const testPrerelease = process.env["VSCODE_SWIFT_VSIX_PRERELEASE"] === "1";
    if (testPrerelease) {
        const prereleaseVSIX = files.find(f =>
            /swift-vscode-\d+.\d+.\d{8}(-dev)?-\d+.vsix/m.test(f.path)
        );
        if (prereleaseVSIX) {
            await appendFile(envFile, `VSCODE_SWIFT_VSIX=${prereleaseVSIX.path}\n`);
            console.log(`Running tests against: ${prereleaseVSIX.path}`);
        } else {
            console.error("Cound not find vscode-swift pre-release VSIX in artifact bundle");
            process.exit(1);
        }
    } else {
        const releaseVSIX = files.find(f =>
            /swift-vscode-\d+.\d+.\d+(-dev)?-\d+.vsix/m.test(f.path)
        );
        if (releaseVSIX) {
            await appendFile(envFile, `VSCODE_SWIFT_VSIX=${releaseVSIX.path}\n`);
            console.log(`Running tests against: ${releaseVSIX.path}`);
        } else {
            console.error("Cound not find vscode-swift release VSIX in artifact bundle");
            process.exit(1);
        }
    }
    await unlink("artifacts.zip");
});
