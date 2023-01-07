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
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { buildDirectoryFromWorkspacePath, execFile } from "../utilities/utilities";
import { WorkspaceContext } from "../WorkspaceContext";

interface TestCoverageReportJson {
    data: TestCoverageReportData[];
}

interface TestCoverageReportData {
    files: { filename: string; summary: TestCoverageReportSummary }[];
    totals: TestCoverageReportSummary;
}

interface TestCoverageReportSummary {
    lines: TestCoverageReportCoverage;
}

interface TestCoverageReportCoverage {
    count: number;
    covered: number;
    percent: number;
}

export class TestCoverageReportProvider implements vscode.Disposable {
    provider: vscode.Disposable;
    onDidChangeEmitter: vscode.EventEmitter<vscode.Uri>;
    constructor(private ctx: WorkspaceContext) {
        this.onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
        this.provider = vscode.workspace.registerTextDocumentContentProvider("swiftTestCoverage", {
            provideTextDocumentContent: async uri => {
                const folderName = path.basename(uri.path, ".md");
                const folder = ctx.folders.find(folder => folder.name === folderName);
                if (!folder) {
                    return `Test coverage report for ${folderName} is unavailable`;
                }
                try {
                    const report = await this.generateCodeCoverageReport(folder);
                    return this.generateMarkdownReport(report, folder); //`<html><body>${report}</body></html>`;
                } catch {
                    return `Failed to generate test coverage report for ${folderName}`;
                }
            },
            onDidChange: this.onDidChangeEmitter.event,
        });
    }

    dispose() {
        this.provider.dispose();
        this.onDidChangeEmitter.dispose();
    }

    generateMarkdownReport(report: TestCoverageReportJson, folder: FolderContext): string {
        const header = `
## Test coverage report for ${folder.name}

|File|Total lines| Hit|Missed|Coverage %|
|----|----------:|---:|-----:|---------:|
`;
        const sections = report.data.map(section => {
            const lines = section.files.map(entry => {
                const filename = path.basename(entry.filename);
                //const relativeFilename = path.relative(folder.folder.fsPath, entry.filename);
                const total = entry.summary.lines.count;
                const hit = entry.summary.lines.covered;
                const missed = entry.summary.lines.count - entry.summary.lines.covered;
                const percent = +entry.summary.lines.percent.toFixed(2);
                return `|[${filename}](vscode://file${entry.filename})|${total}|${hit}|${missed}|${percent}|`;
            });
            const total = section.totals.lines.count;
            const hit = section.totals.lines.covered;
            const missed = section.totals.lines.count - section.totals.lines.covered;
            const percent = +section.totals.lines.percent.toFixed(2);
            const totals = `|**Totals**|${total}|${hit}|${missed}|${percent}|\n`;
            return `${lines.join("\n")}\n| | | | |\n${totals}`;
        });
        return header + sections.join("\n");
    }

    async generateCodeCoverageReport(
        folderContext: FolderContext
    ): Promise<TestCoverageReportJson> {
        const workspaceContext = folderContext.workspaceContext;
        const llvmCov = workspaceContext.toolchain.getToolchainExecutable("llvm-cov");
        const packageName = folderContext.swiftPackage.name;
        const buildDirectory = buildDirectoryFromWorkspacePath(folderContext.folder.fsPath, true);

        let xctestFile = `${buildDirectory}/debug/${packageName}PackageTests.xctest`;
        if (process.platform === "darwin") {
            xctestFile += `/Contents/MacOs/${packageName}PackageTests`;
        }
        const { stdout } = await execFile(
            llvmCov,
            [
                "export",
                "-format=text",
                "-summary-only",
                xctestFile,
                "-ignore-filename-regex=Tests|.build|Snippets|Plugins",
                `-instr-profile=${buildDirectory}/debug/codecov/default.profdata`,
            ],
            {
                env: { ...process.env, ...configuration.swiftEnvironmentVariables },
            },
            folderContext
        );
        return JSON.parse(stdout);
    }
}
