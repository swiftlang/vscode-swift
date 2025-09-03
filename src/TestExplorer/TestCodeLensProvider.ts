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

import configuration, { ValidCodeLens } from "../configuration";
import { TestExplorer } from "./TestExplorer";
import { flattenTestItemCollection } from "./TestUtils";

export class TestCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    public onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
    private disposables: vscode.Disposable[] = [];

    constructor(private testExplorer: TestExplorer) {
        this.disposables = [
            testExplorer.onTestItemsDidChange(() => this.onDidChangeCodeLensesEmitter.fire()),
            vscode.languages.registerCodeLensProvider({ language: "swift", scheme: "file" }, this),
        ];
    }

    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        const config = configuration.showTestCodeLenses;
        if (config === false || (Array.isArray(config) && config.length === 0)) {
            return [];
        }

        const items = flattenTestItemCollection(this.testExplorer.controller.items);
        return items
            .filter(item => item.uri?.fsPath === document.uri.fsPath)
            .flatMap(item => this.codeLensesForTestItem(item, config));
    }

    private codeLensesForTestItem(
        item: vscode.TestItem,
        config: boolean | ValidCodeLens[]
    ): vscode.CodeLens[] {
        if (!item.range) {
            return [];
        }

        const lensConfigs: Array<{
            type: ValidCodeLens;
            title: string;
            command: string;
        }> = [
            {
                type: "run",
                title: "$(play)\u00A0Run",
                command: "swift.runTest",
            },
            {
                type: "debug",
                title: "$(debug)\u00A0Debug",
                command: "swift.debugTest",
            },
            {
                type: "coverage",
                title: "$(debug-coverage)\u00A0Run w/ Coverage",
                command: "swift.runTestWithCoverage",
            },
        ];

        return lensConfigs
            .filter(
                lensConfig =>
                    config === true || (Array.isArray(config) && config.includes(lensConfig.type))
            )
            .map(
                lensConfig =>
                    new vscode.CodeLens(item.range!, {
                        title: lensConfig.title,
                        command: lensConfig.command,
                        arguments: [item],
                    })
            );
    }
}
