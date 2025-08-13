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

import { execFile } from "./utilities";

// use `type swift` to find `swift`. Run inside /bin/sh to ensure
// we get consistent output as different shells output a different
// format. Tried running with `-p` but that is not available in /bin/sh
export async function findBinaryPath(binaryName: string): Promise<string> {
    const { stdout, stderr } = await execFile("/bin/sh", [
        "-c",
        `LC_MESSAGES=C type ${binaryName}`,
    ]);
    const binaryNameMatch = new RegExp(`^${binaryName} is (.*)$`).exec(stdout.trimEnd());
    if (binaryNameMatch) {
        return binaryNameMatch[1];
    } else {
        throw Error(
            `/bin/sh -c LC_MESSAGES=C type ${binaryName}: stdout: ${stdout}, stderr: ${stderr}`
        );
    }
}
