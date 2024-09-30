//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { Command } from "vscode-languageclient";
import { LanguageClientManager } from "../sourcekit-lsp/LanguageClientManager";
import { WorkspaceContext, FolderOperation } from "../WorkspaceContext";

export class LanguageStatusItems implements vscode.Disposable {
    private packageSwiftItem: vscode.LanguageStatusItem;

    constructor(workspaceContext: WorkspaceContext) {
        // Swift language version item
        const swiftVersionItem = vscode.languages.createLanguageStatusItem(
            "swiftlang-version",
            LanguageClientManager.documentSelector
        );
        swiftVersionItem.text = workspaceContext.toolchain.swiftVersionString;
        swiftVersionItem.accessibilityInformation = {
            label: `Swift Version ${workspaceContext.toolchain.swiftVersion.toString()}`,
        };

        // Package.swift item
        this.packageSwiftItem = vscode.languages.createLanguageStatusItem("swiftlang-package", [
            ...LanguageClientManager.appleLangDocumentSelector,
            ...LanguageClientManager.cFamilyDocumentSelector,
        ]);
        this.packageSwiftItem.text = "No Package.swift";
        this.packageSwiftItem.accessibilityInformation = { label: "There is no Package.swift" };

        // Update Package.swift item based on current focus
        const onFocus = workspaceContext.onDidChangeFolders(async ({ folder, operation }) => {
            switch (operation) {
                case FolderOperation.focus:
                    if (folder && folder.swiftPackage.foundPackage) {
                        this.packageSwiftItem.text = "Package.swift";
                        this.packageSwiftItem.command = Command.create(
                            "Open Package",
                            "swift.openPackage"
                        );
                        this.packageSwiftItem.accessibilityInformation = {
                            label: "Open Package.swift",
                        };
                    } else {
                        this.packageSwiftItem.text = "No Package.swift";
                        this.packageSwiftItem.accessibilityInformation = {
                            label: "There is no Package.swift",
                        };
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
