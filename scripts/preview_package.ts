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
import {
    exec,
    getExtensionVersion,
    getRootDirectory,
    main,
    updateChangelog,
} from "./lib/utilities";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { preview } = require("./versions");

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main(async () => {
    const rootDirectory = getRootDirectory();
    const version = await getExtensionVersion();
    // Increment the minor version and set the patch version to today's date
    const minor = version.minor + 1;
    const previewVersion = preview(version);
    // Make sure that the new minor version is odd
    if (minor % 2 !== 1) {
        throw new Error(
            `The minor version for the pre-release extension is even (${previewVersion}).` +
                " The version in the package.json has probably been incorrectly set to an odd minor version."
        );
    }
    // Update version in CHANGELOG
    await updateChangelog(previewVersion);
    // Use VSCE to package the extension
    await exec(
        "npx",
        ["vsce", "package", "--pre-release", "--no-update-package-json", previewVersion],
        { cwd: rootDirectory }
    );
});
