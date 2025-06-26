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

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main(async () => {
    const rootDirectory = getRootDirectory();
    const version = await getExtensionVersion();
    const versionString = `${version.major}.${version.minor}.${version.patch}`;

    if (process.platform === "win32") {
        console.log("Packaging the extension is not supported on Windows.");
        return process.exit(0);
    }

    // Update version in CHANGELOG
    await updateChangelog(versionString);
    // Use VSCE to package the extension
    await exec("npx", ["vsce", "package"], {
        cwd: rootDirectory,
    });
});
