//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as lcov from "lcov-parse";
import * as fs from "fs";
import * as asyncfs from "fs/promises";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { execFileStreamOutput } from "../utilities/utilities";
import { BuildFlags } from "../toolchain/BuildFlags";

/**
 * Class keeping a record of the latest test coverage results for a package
 */
export class LcovResults implements vscode.Disposable {
    public contents: lcov.LcovFile[] | undefined;
    public observer: ((results: LcovResults) => unknown) | undefined;

    constructor(public folderContext: FolderContext) {
        this.load();
    }

    dispose() {
        this.observer = undefined;
    }

    /**
     * Generate LCOV file from profdata output by `swift test --enable-code-coverage`. Then
     * load these results into the contents.
     */
    async generate() {
        const llvmCov =
            this.folderContext.workspaceContext.toolchain.getToolchainExecutable("llvm-cov");
        const packageName = this.folderContext.swiftPackage.name;
        const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(
            this.folderContext.folder.fsPath,
            true
        );
        const lcovFileName = `${buildDirectory}/debug/codecov/lcov.info`;

        // Use WriteStream to log results
        const lcovStream = fs.createWriteStream(lcovFileName);

        try {
            let xctestFile = `${buildDirectory}/debug/${packageName}PackageTests.xctest`;
            if (process.platform === "darwin") {
                xctestFile += `/Contents/MacOs/${packageName}PackageTests`;
            }
            await execFileStreamOutput(
                llvmCov,
                [
                    "export",
                    "-format",
                    "lcov",
                    xctestFile,
                    "-ignore-filename-regex=Tests|.build|Snippets|Plugins",
                    `-instr-profile=${buildDirectory}/debug/codecov/default.profdata`,
                ],
                lcovStream,
                lcovStream,
                null,
                {
                    env: { ...process.env, ...configuration.swiftEnvironmentVariables },
                    maxBuffer: 16 * 1024 * 1024,
                },
                this.folderContext
            );
            await this.lcovFileChanged();
        } catch (error) {
            lcovStream.end();
            throw error;
        }
    }

    get exist(): boolean {
        return this.contents !== undefined;
    }

    /**
     * Get the code coverage results for a specified file
     * @param filename File we want code coverage data for
     * @returns Code coverage results
     */
    resultsForFile(filename: string): lcov.LcovFile | undefined {
        return this.contents?.find(item => item.file === filename);
    }

    get totals(): { hit: number; found: number } | undefined {
        if (!this.contents) {
            return undefined;
        }
        let hit = 0;
        let found = 0;
        this.contents.forEach(file => {
            hit += file.lines.hit;
            found += file.lines.found;
        });
        return { hit: hit, found: found };
    }

    private async lcovFileChanged() {
        await this.load();
        if (this.observer) {
            this.observer(this);
        }
    }

    private async load() {
        const lcovFile = this.lcovFilename();
        try {
            const buffer = await asyncfs.readFile(lcovFile, "utf8");
            this.contents = await this.loadLcov(buffer);
        } catch {
            // LCOV file failed to load, but that's ok
        }
    }

    private async loadLcov(lcovContents: string): Promise<lcov.LcovFile[] | undefined> {
        return new Promise<lcov.LcovFile[]>((resolve, reject) => {
            lcov.source(lcovContents, (error, data) => {
                if (error) {
                    reject(error);
                } else if (data) {
                    resolve(data);
                }
            });
        });
    }

    private lcovFilename() {
        const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(
            this.folderContext.folder.fsPath,
            true
        );
        return `${buildDirectory}/debug/codecov/lcov.info`;
    }
}
