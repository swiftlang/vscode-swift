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
import { getExtensionVersion, main, packageExtension, releasedVersions } from "./lib/utilities";

import "@vscode/vsce";

main(async () => {
    const releases = await releasedVersions("swiftlang.swift-vscode");
    const version = await getExtensionVersion();
    // Decrement the minor version and set a patch
    const minor = version.minor - 2;
    let patch = 1;
    let previewVersion = `${version.major}.${minor}.${patch}`;
    while (releases.includes(previewVersion)) {
        patch += 1;
        previewVersion = `${version.major}.${minor}.${patch}`;
    }
    // Make sure that the new minor version is odd
    if (minor % 2 !== 0) {
        throw new Error(
            `The minor version for the patch release extension is odd (${previewVersion}).` +
                " The version in the package.json has probably been incorrectly set to an even minor version."
        );
    }
    await packageExtension(previewVersion);
});
