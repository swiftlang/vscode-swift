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

import * as vscode from "vscode";
import { Command } from "vscode-languageclient";
import { WorkspaceContext, FolderEvent } from "../WorkspaceContext";

export class LanguageStatusItems implements vscode.Disposable {
    /** Document selector defining when items should be displayed */
    static documentSelector: vscode.DocumentSelector = [
        { scheme: "file", language: "swift" },
        { scheme: "untitled", language: "swift" },
        { scheme: "file", language: "c" },
        { scheme: "untitled", language: "c" },
        { scheme: "file", language: "cpp" },
        { scheme: "untitled", language: "cpp" },
        { scheme: "file", language: "objective-c" },
        { scheme: "untitled", language: "objective-c" },
        { scheme: "file", language: "objective-cpp" },
        { scheme: "untitled", language: "objective-cpp" },
    ];

    private packageSwiftItem: vscode.LanguageStatusItem;

    constructor(workspaceContext: WorkspaceContext) {
        // Swift language version item
        const swiftVersionItem = vscode.languages.createLanguageStatusItem(
            "swiftlang-version",
            LanguageStatusItems.documentSelector
        );
        swiftVersionItem.detail = `Swift Version ${workspaceContext.swiftVersion.major}.${workspaceContext.swiftVersion.minor}.${workspaceContext.swiftVersion.patch}`;

        // Package.swift item
        this.packageSwiftItem = vscode.languages.createLanguageStatusItem(
            "swiftlang-package",
            LanguageStatusItems.documentSelector
        );
        this.packageSwiftItem.detail = "No Package.swift";

        // Update Package.swift item based on current focus
        const onFocus = workspaceContext.observeFolders(async (folder, event) => {
            switch (event) {
                case FolderEvent.focus:
                    if (folder) {
                        this.packageSwiftItem.detail = "Package.swift";
                        this.packageSwiftItem.command = Command.create(
                            "Open Package",
                            "swift.openPackage"
                        );
                    } else {
                        this.packageSwiftItem.detail = "No Package.swift";
                        this.packageSwiftItem.command = undefined;
                    }
            }
        });
        this.subscriptions = [onFocus, swiftVersionItem, this.packageSwiftItem];
    }

    dispose() {
        this.subscriptions.forEach(element => element.dispose());
    }

    private subscriptions: { dispose(): unknown }[];
}
