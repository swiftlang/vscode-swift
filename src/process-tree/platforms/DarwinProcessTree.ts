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

import { LinuxProcessTree } from "./LinuxProcessTree";

export class DarwinProcessTree extends LinuxProcessTree {
    protected override getCommandArguments(): string[] {
        return [
            "-axo",
            // The length of comm must be large enough or data will be truncated.
            `pid=PID,state=STATE,lstart=START,comm=${"COMMAND".padEnd(256, "-")},args=ARGUMENTS`,
        ];
    }
}
