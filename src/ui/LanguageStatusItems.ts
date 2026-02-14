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

import { FolderOperation, WorkspaceContext } from "../WorkspaceContext";
import { Commands } from "../commands";
import { LanguagerClientDocumentSelectors } from "../sourcekit-lsp/LanguageClientConfiguration";

export class LanguageStatusItems implements vscode.Disposable {
    constructor(workspaceContext: WorkspaceContext) {
        // Swift language version item
        const swiftVersionItem = vscode.languages.createLanguageStatusItem(
            "swiftlang-version",
            LanguagerClientDocumentSelectors.allHandledDocumentTypes()
        );
        const toolchain =
            workspaceContext.currentFolder?.toolchain ?? workspaceContext.globalToolchain;
        swiftVersionItem.text = toolchain.swiftVersionString;
        swiftVersionItem.accessibilityInformation = {
            label: `Swift Version ${toolchain.swiftVersion.toString()}`,
        };

        swiftVersionItem.command = Command.create("Select Toolchain", Commands.SELECT_TOOLCHAIN);

        // Package.swift item
        const packageSwiftItem = vscode.languages.createLanguageStatusItem("swiftlang-package", [
            ...LanguagerClientDocumentSelectors.appleLangDocumentSelector,
            ...LanguagerClientDocumentSelectors.cFamilyDocumentSelector,
        ]);
        packageSwiftItem.text = "No Package.swift";
        packageSwiftItem.accessibilityInformation = { label: "There is no Package.swift" };

        // Update Package.swift item based on current focus
        const onFocus = workspaceContext.onDidChangeFolders(async ({ folder, operation }) => {
            if (operation === FolderOperation.focus) {
                if (folder && (await folder.swiftPackage.foundPackage)) {
                    packageSwiftItem.text = "Package.swift";
                    packageSwiftItem.command = Command.create("Open Package", "swift.openPackage");
                    packageSwiftItem.accessibilityInformation = {
                        label: "Open Package.swift",
                    };

                    swiftVersionItem.text = folder.toolchain.swiftVersionString;
                    swiftVersionItem.accessibilityInformation = {
                        label: `Swift Version ${folder.toolchain.swiftVersion.toString()}`,
                    };
                } else {
                    packageSwiftItem.text = "No Package.swift";
                    packageSwiftItem.accessibilityInformation = {
                        label: "There is no Package.swift",
                    };
                    packageSwiftItem.command = undefined;

                    swiftVersionItem.text = workspaceContext.globalToolchain.swiftVersionString;
                    swiftVersionItem.accessibilityInformation = {
                        label: `Swift Version ${workspaceContext.globalToolchain.swiftVersion.toString()}`,
                    };
                }
            }
        });
        this.subscriptions = [onFocus, swiftVersionItem, packageSwiftItem];
    }

    dispose() {
        this.subscriptions.forEach(element => element.dispose());
    }

    private subscriptions: { dispose(): unknown }[];
}
