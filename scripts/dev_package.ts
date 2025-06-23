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
    // Increment the patch version from the package.json
    const patch = version.patch + 1;
    const devVersion = `${version.major}.${version.minor}.${patch}-dev`;
    // Update version in CHANGELOG
    await updateChangelog(devVersion);
    // Use VSCE to package the extension
    await exec("npx", ["vsce", "package", "--no-update-package-json", devVersion], {
        cwd: rootDirectory,
    });
});
