//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { PackageNode } from "../ui/PackageDependencyProvider";

/**
 * Opens the supplied `PackageNode` externally using the default application.
 * @param packageNode PackageNode attached to dependency tree item
 */
export function openInExternalEditor(packageNode: PackageNode) {
    try {
        const uri = vscode.Uri.parse(packageNode.location, true);
        vscode.env.openExternal(uri);
    } catch {
        // ignore error
    }
}
