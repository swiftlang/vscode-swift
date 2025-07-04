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
    // Note: There are no sendgrid secrets in the extension. `--allow-package-secrets` works around a false positive
    // where the symbol `SG.MessageTransports.is` can appear in the dist.js if we're unlucky enough
    // to have `SG` as the minified name of a namespace. Here is the rule we sometimes mistakenly match:
    // https://github.com/secretlint/secretlint/blob/5706ac4942f098b845570541903472641d4ae914/packages/%40secretlint/secretlint-rule-sendgrid/src/index.ts#L35
    await exec("npx", ["vsce", "package", "--allow-package-secrets", "sendgrid"], {
        cwd: rootDirectory,
    });
});
