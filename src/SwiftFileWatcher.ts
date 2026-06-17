//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as vscode from "vscode";

import { FolderContext } from "./FolderContext";
import { FileOperation, SwiftFileEvent } from "./SwiftExtensionApi";

/**
 * Watches for changes to `.swift` files within a single {@link FolderContext}.
 *
 * The watcher is scoped to the folder via a {@link vscode.RelativePattern} so that
 * generated build output living outside of any Swift package folder (for example a
 * repo-local Bazel `output_base`) is not traversed. See
 * https://github.com/swiftlang/vscode-swift/issues/2272.
 */
export class SwiftFileWatcher {
    private fileWatcher: vscode.FileSystemWatcher;

    constructor(
        private folderContext: FolderContext,
        private onSwiftFileChange: (event: SwiftFileEvent) => void
    ) {
        this.fileWatcher = this.createFileWatcher();
    }

    dispose() {
        this.fileWatcher.dispose();
    }

    private createFileWatcher(): vscode.FileSystemWatcher {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(this.folderContext.folder, "**/*.swift")
        );
        watcher.onDidCreate(uri =>
            this.onSwiftFileChange({ uri, operation: FileOperation.created })
        );
        watcher.onDidChange(uri =>
            this.onSwiftFileChange({ uri, operation: FileOperation.changed })
        );
        watcher.onDidDelete(uri =>
            this.onSwiftFileChange({ uri, operation: FileOperation.deleted })
        );
        return watcher;
    }
}
