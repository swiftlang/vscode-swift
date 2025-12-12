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
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

export async function createMockFolderContext(
    toolchainPath: string,
    isDev: boolean = false
): Promise<FolderContext> {
    // Create a mock version object with proper methods
    const mockVersion = new Version(6, 2, 0, isDev);

    // Create a mock toolchain with the specified path instead of calling SwiftToolchain.create
    const mockToolchain = {
        manager: "unknown" as const,
        swiftFolderPath: `${toolchainPath}/bin`,
        toolchainPath: toolchainPath,
        swiftVersion: mockVersion,
        swiftVersionString: isDev ? "Swift version 6.2.0-dev" : "Swift version 6.2.0",
        getToolchainExecutable: (executable: string) => `${toolchainPath}/bin/${executable}`,
    } as SwiftToolchain;

    return {
        folder: vscode.Uri.file("/test/workspace"),
        swiftVersion: mockVersion,
        toolchain: mockToolchain,
        name: "TestFolder",
    } as FolderContext;
}
