//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as lcov from "lcov-parse";
import * as asyncfs from "fs/promises";
import * as path from "path";
import { Writable } from "stream";
import { promisify } from "util";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { execFileStreamOutput } from "../utilities/utilities";
import { BuildFlags } from "../toolchain/BuildFlags";
import { TestLibrary } from "../TestExplorer/TestRunner";
import { DisposableFileCollection } from "../utilities/tempFolder";
import { TargetType } from "../SwiftPackage";

interface CodeCovFile {
    testLibrary: TestLibrary;
    path: string;
}

export class TestCoverage {
    private lcovFiles: CodeCovFile[] = [];
    private lcovTmpFiles: DisposableFileCollection;
    private coverageDetails = new Map<vscode.Uri, vscode.FileCoverageDetail[]>();

    constructor(private folderContext: FolderContext) {
        const tmpFolder = folderContext.workspaceContext.tempFolder;
        this.lcovTmpFiles = tmpFolder.createDisposableFileCollection();
    }

    /**
     * Returns coverage information for the suppplied URI.
     */
    public loadDetailedCoverage(uri: vscode.Uri) {
        return this.coverageDetails.get(uri) || [];
    }

    /**
     * Captures the coverage data after an individual test binary has been run.
     * After the test run completes then the coverage is merged.
     */
    public async captureCoverage(testLibrary: TestLibrary) {
        const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(
            this.folderContext.folder.fsPath,
            true
        );
        const result = await asyncfs.readFile(`${buildDirectory}/debug/codecov/default.profdata`);
        const filename = this.lcovTmpFiles.file(testLibrary, "profdata");
        await asyncfs.writeFile(filename, result);
        this.lcovFiles.push({ testLibrary, path: filename });
    }

    /**
     * Once all test binaries have been run compute the coverage information and
     * associate it with the test run.
     */
    async computeCoverage(testRun: vscode.TestRun) {
        const lcovFiles = await this.computeLCOVCoverage();
        if (lcovFiles.length > 0) {
            for (const sourceFileCoverage of lcovFiles) {
                const uri = vscode.Uri.file(sourceFileCoverage.file);
                const detailedCoverage: vscode.FileCoverageDetail[] = [];
                for (const lineCoverage of sourceFileCoverage.lines.details) {
                    const statementCoverage = new vscode.StatementCoverage(
                        lineCoverage.hit,
                        new vscode.Position(lineCoverage.line - 1, 0)
                    );
                    detailedCoverage.push(statementCoverage);
                }

                const coverage = vscode.FileCoverage.fromDetails(uri, detailedCoverage);
                testRun.addCoverage(coverage);
                this.coverageDetails.set(uri, detailedCoverage);
            }
        }
        this.lcovTmpFiles.dispose();
    }

    /**
     * Merges multiple `.profdata` files into a single `.profdata` file.
     */
    private async mergeProfdata(profDataFiles: string[]) {
        const filename = this.lcovTmpFiles.file("merged", "profdata");
        const toolchain = this.folderContext.workspaceContext.toolchain;
        const llvmProfdata = toolchain.getToolchainExecutable("llvm-profdata");
        await execFileStreamOutput(
            llvmProfdata,
            ["merge", "-sparse", "-o", filename, ...profDataFiles],
            null,
            null,
            null,
            {
                env: process.env,
                maxBuffer: 16 * 1024 * 1024,
            },
            this.folderContext
        );

        return filename;
    }

    private async computeLCOVCoverage(): Promise<lcov.LcovFile[]> {
        if (this.lcovFiles.length === 0) {
            return [];
        }

        try {
            // Merge all the profdata files from each test binary.
            const mergedProfileFile = await this.mergeProfdata(
                this.lcovFiles.map(({ path }) => path)
            );

            // Then export to the final lcov file that
            // can be processed and fed to VS Code.
            const lcovData = await this.exportProfdata(
                this.lcovFiles.map(({ testLibrary }) => testLibrary),
                mergedProfileFile
            );

            return await this.loadLcov(lcovData.toString("utf8"));
        } catch (error) {
            return [];
        }
    }

    /**
     * Exports a `.profdata` file using `llvm-cov export`, returning the result as a `Buffer`.
     */
    private async exportProfdata(types: TestLibrary[], mergedProfileFile: string): Promise<Buffer> {
        const packageName = this.folderContext.swiftPackage.name;
        const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(
            this.folderContext.folder.fsPath,
            true
        );

        const coveredBinaries: string[] = [];
        if (types.includes(TestLibrary.xctest)) {
            let xcTestBinary = `${buildDirectory}/debug/${packageName}PackageTests.xctest`;
            if (process.platform === "darwin") {
                xcTestBinary += `/Contents/MacOS/${packageName}PackageTests`;
            }
            coveredBinaries.push(xcTestBinary);
        }

        if (types.includes(TestLibrary.swiftTesting)) {
            const swiftTestBinary = `${buildDirectory}/debug/${packageName}PackageTests.swift-testing`;
            coveredBinaries.push(swiftTestBinary);
        }

        let buffer = Buffer.alloc(0);
        const writableStream = new Writable({
            write(chunk, encoding, callback) {
                buffer = Buffer.concat([buffer, chunk]);
                callback();
            },
        });

        await execFileStreamOutput(
            this.folderContext.workspaceContext.toolchain.getToolchainExecutable("llvm-cov"),
            [
                "export",
                "--format",
                "lcov",
                ...coveredBinaries,
                `--ignore-filename-regex=${this.ignoredFilenamesRegex()}`,
                `--instr-profile=${mergedProfileFile}`,
            ],
            writableStream,
            writableStream,
            null,
            {
                env: { ...process.env, ...configuration.swiftEnvironmentVariables },
                maxBuffer: 16 * 1024 * 1024,
            },
            this.folderContext
        );

        return buffer;
    }

    /**
     * Constructs a string containing all the paths to exclude from the code coverage report.
     * This should exclude everything in the `.build` folder as well as all the test targets.
     */
    private ignoredFilenamesRegex(): string {
        const basePath = this.folderContext.folder.path;
        const buildFolder = path.join(basePath, ".build");
        const testTargets = this.folderContext.swiftPackage
            .getTargets(TargetType.test)
            .map(target => path.join(basePath, target.path));

        return [buildFolder, ...testTargets].join("|");
    }

    private async loadLcov(lcovContents: string): Promise<lcov.LcovFile[]> {
        return promisify(lcov.source)(lcovContents).then(value => value ?? []);
    }
}
