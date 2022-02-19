//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { tmpdir } from "os";
import * as path from "path";
import * as fs from "fs/promises";

export class TemporaryFolder {
    private constructor(public path: string) {}

    dispose() {
        fs.rmdir(this.path, { recursive: true });
    }

    static async create(): Promise<TemporaryFolder> {
        const prefix = path.join(tmpdir(), "vscode-swift");
        const tmpPath = await fs.mkdtemp(prefix);
        return new TemporaryFolder(tmpPath);
    }
}
