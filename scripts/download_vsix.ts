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
    await rename(files[0].path, newName);
    console.log(`Renamed artifact: ${files[0].path} => ${newName}`);
    await unlink("artifacts.zip");
})();
