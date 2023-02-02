//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2023 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import { FolderContext } from "../FolderContext";
import { WorkspaceContext } from "../WorkspaceContext";

export class TestCoverageReportProvider implements vscode.Disposable {
    provider: vscode.Disposable;
    onDidChangeEmitter: vscode.EventEmitter<vscode.Uri>;
    constructor(private ctx: WorkspaceContext) {
        this.onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
        this.provider = vscode.workspace.registerTextDocumentContentProvider("swiftTestCoverage", {
            provideTextDocumentContent: uri => {
                const folderName = path.basename(uri.path, " coverage");
                const folder = ctx.folders.find(folder => folder.name === folderName);
                if (!folder) {
                    return `Test coverage report for ${folderName} is unavailable`;
                }
                const report = this.generateMarkdownReport(folder);
                return report ?? `Failed to generate test coverage report for ${folderName}`;
            },
            onDidChange: this.onDidChangeEmitter.event,
        });
    }

    dispose() {
        this.provider.dispose();
        this.onDidChangeEmitter.dispose();
    }

    show(folder: FolderContext) {
        const testCoverageUri = vscode.Uri.parse(
            `swiftTestCoverage://report/${folder.name} coverage`
        );
        this.onDidChangeEmitter.fire(testCoverageUri);
        vscode.commands.executeCommand("markdown.showPreview", testCoverageUri);
        vscode.commands.executeCommand("markdown.refreshPreview", testCoverageUri);
    }

    generateMarkdownReport(folder: FolderContext): string | undefined {
        const lcov = folder.lcovResults;
        if (!lcov.contents) {
            return undefined;
        }
        const header = `
## Test coverage report for ${folder.name}

|File|Total lines| Hit|Missed|Coverage %|
|----|----------:|---:|-----:|---------:|
`;
        const files = lcov.contents.map(file => {
            const filename = path.basename(file.file);
            const total = file.lines.found;
            const hit = file.lines.hit;
            const missed = total - hit;
            const percent = ((100.0 * hit) / total).toFixed(2);
            return `|[${filename}](vscode://file${file.file})|${total}|${hit}|${missed}|${percent}|`;
        });
        const lcovTotals = lcov.totals;

        const total = lcovTotals!.found;
        const hit = lcovTotals!.hit;
        const missed = total - hit;
        const percent = ((100.0 * hit) / total).toFixed(2);
        const totals = `\n| | | | |\n|**Totals**|${total}|${hit}|${missed}|${percent}|\n`;

        return header + files.join("\n") + totals;
    }
}
