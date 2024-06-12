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

import * as fs from "fs/promises";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { TemporaryFolder } from "./tempFolder";

/**
 * Checks to see if the platform allows creating symlinks.
 *
 * @returns whether or not a symlink can be created
 */
export async function isSymlinkAllowed(outputChannel?: SwiftOutputChannel): Promise<boolean> {
    const temporaryFolder = await TemporaryFolder.create();
    return await temporaryFolder.withTemporaryFile("", async testFilePath => {
        const testSymlinkPath = temporaryFolder.filename("symlink-");
        try {
            await fs.symlink(testFilePath, testSymlinkPath, "file");
            await fs.unlink(testSymlinkPath);
            return true;
        } catch (error) {
            outputChannel?.log(`${error}`);
            return false;
        }
    });
}
