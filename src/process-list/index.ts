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
import { DarwinProcessList } from "./platforms/DarwinProcessList";
import { LinuxProcessList } from "./platforms/LinuxProcessList";
import { WindowsProcessList } from "./platforms/WindowsProcessList";

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

export interface ProcessList {
    listAllProcesses(): Promise<Process[]>;
}

/** Returns a {@link ProcessList} based on the current platform. */
export function createProcessList(): ProcessList {
    switch (process.platform) {
        case "darwin":
            return new DarwinProcessList();
        case "win32":
            return new WindowsProcessList();
        default:
            return new LinuxProcessList();
    }
}
