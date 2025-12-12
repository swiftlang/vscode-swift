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
import { FolderContext } from "../../FolderContext";
import { PackageContents } from "../../SwiftPackage";
import { SwiftTaskProvider } from "../../tasks/SwiftTaskProvider";
import { executeSwiftPackageCommand } from "./common";

/**
 * Run `swift package describe` inside a folder
 * @param folderContext folder to run describe for
 */
export async function describePackage(folderContext: FolderContext): Promise<PackageContents> {
    const result = await executeSwiftPackageCommand<PackageContents>(folderContext, {
        args: ["package", "describe", "--type", "json"],
        taskName: SwiftTaskProvider.describePackageName,
        uiMessage: "Describing Package",
        commandName: "package describe",
    });

    return result;
}
