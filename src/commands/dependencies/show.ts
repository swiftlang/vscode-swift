//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { FolderContext } from "../../FolderContext";
import { Dependency } from "../../SwiftPackage";
import { SwiftTaskProvider } from "../../tasks/SwiftTaskProvider";
import { executeSwiftPackageCommand } from "./describe";

/**
 * Run `swift package show-dependencies` inside a folder
 * @param folderContext folder to run show-dependencies for
 */
export async function showPackageDependencies(
    folderContext: FolderContext,
    token?: vscode.CancellationToken
): Promise<Dependency[]> {
    const result = await executeSwiftPackageCommand<{ dependencies: Dependency[] }>(
        folderContext,
        {
            args: ["package", "show-dependencies", "--format", "json"],
            taskName: SwiftTaskProvider.showDependenciesName,
            uiMessage: "Determining Dependencies",
            commandName: "package show-dependencies",
        },
        token
    );

    // Validate the parsed output has the expected structure
    if (!Array.isArray(result.dependencies)) {
        throw new Error(
            "Invalid dependencies format received from swift package show-dependencies command"
        );
    }

    return result.dependencies;
}
