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

import { DarwinProcessTree } from "./platforms/DarwinProcessTree";
import { LinuxProcessTree } from "./platforms/LinuxProcessTree";
import { WindowsProcessTree } from "./platforms/WindowsProcessTree";

/**
 * Represents a single process running on the system.
 */
export interface Process {
    /** Process ID */
    id: number;

    /** Command that was used to start the process */
    command: string;

    /** The full command including arguments that was used to start the process */
    arguments: string;

    /** The date when the process was started */
    start: number;
}

export interface ProcessTree {
    listAllProcesses(): Promise<Process[]>;
}

/** Returns a {@link ProcessTree} based on the current platform. */
export function createProcessTree(): ProcessTree {
    switch (process.platform) {
        case "darwin":
            return new DarwinProcessTree();
        case "win32":
            return new WindowsProcessTree();
        default:
            return new LinuxProcessTree();
    }
}
