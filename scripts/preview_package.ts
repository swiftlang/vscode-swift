//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
/* eslint-disable no-console */

import * as path from "path";
import * as semver from "semver";
import { readFile } from "fs/promises";
import { exec } from "./lib/utilities";

/**
 * Formats the given date as a string in the form "YYYYMMddhhmm".
 *
 * @param date The date to format as a string.
 * @returns The formatted date.
 */
function formatDate(date: Date): string {
    const year = date.getUTCFullYear().toString().padStart(4, "0");
    const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = date.getUTCDate().toString().padStart(2, "0");
    const hour = date.getUTCHours().toString().padStart(2, "0");
    const minutes = date.getUTCMinutes().toString().padStart(2, "0");
    return year + month + day + hour + minutes;
}

(async () => {
    const rootDirectory = path.join(__dirname, "..");
    // Grab the existing version number from the package.json
    const packageJSON = JSON.parse(
        await readFile(path.join(rootDirectory, "package.json"), "utf-8")
    );
    if (typeof packageJSON.version !== "string") {
        throw new Error("Version number in package.json is not a string");
    }
    const version = semver.parse(packageJSON.version);
    if (version === null) {
        throw new Error("Unable to parse version number in package.json");
    }
    // Increment the minor version and set the patch version to today's date
    const minor = version.minor + 1;
    const patch = formatDate(new Date());
    const previewVersion = `${version.major}.${minor}.${patch}`;
    await exec(
        "npx",
        ["vsce", "package", "--pre-release", "--no-update-package-json", previewVersion],
        { cwd: rootDirectory }
    );
})().catch(error => {
    console.error(error);
    process.exit(1);
});
