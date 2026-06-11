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
import * as assert from "assert";
import { expect } from "chai";
import * as fs from "fs/promises";
import * as vscode from "vscode";
import * as yauzl from "yauzl";

import { WorkspaceContext } from "@src/WorkspaceContext";
import { captureDiagnostics } from "@src/commands/captureDiagnostics";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";
import { unwrapPromise } from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import { mockFn, mockGlobalObject } from "../../MockUtils";
import { tag } from "../../tags";
import { TestLogger } from "../../utilities/TestLogger";
import { executeTaskAndWaitForResult } from "../../utilities/tasks";
import { activateExtensionForSuite, folderInRootWorkspace } from "../utilities/testutilities";

tag("medium").suite("captureDiagnostics() Test Suite", function () {
    let workspaceContext: WorkspaceContext;
    let zipFilePath: string | undefined;
    const mockWindow = mockGlobalObject(vscode, "window");
    const progressReport = { report: () => {} } as vscode.Progress<{ message?: string }>;

    activateExtensionForSuite({
        async setup(api) {
            workspaceContext = await api.waitForWorkspaceContext();
        },
        testAssets: ["defaultPackage", "dependencies"],
    });

    setup(() => {
        mockWindow.showInformationMessage.resolves("Capture Minimal Diagnostics" as any);
        mockWindow.withProgress.callsFake(async (_options, task) => {
            return await task(progressReport, new vscode.CancellationTokenSource().token);
        });
    });

    teardown(async () => {
        if (!zipFilePath) {
            return;
        }

        await fs.rm(zipFilePath);
        zipFilePath = undefined;
    });

    test("Does not offer minimal capture when requiresFullDiagnostics is true", async () => {
        mockWindow.showInformationMessage.resolves(undefined);

        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                requiresFullDiagnostics: true,
                showSwiftOutputChannel: mockFn(),
            },
            new TestLogger()
        );

        expect(mockWindow.showInformationMessage).to.have.been.calledOnce;
        const showInfoArgs = mockWindow.showInformationMessage.firstCall.args;
        expect(showInfoArgs).to.not.include("Capture Minimal Diagnostics");
        expect(showInfoArgs).to.include("Capture Full Diagnostics");
    });

    test("Offers both capture modes when requiresFullDiagnostics is false", async () => {
        mockWindow.showInformationMessage.resolves(undefined);

        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                requiresFullDiagnostics: false,
                showSwiftOutputChannel: mockFn(),
            },
            new TestLogger()
        );

        expect(mockWindow.showInformationMessage).to.have.been.calledOnce;
        const showInfoArgs = mockWindow.showInformationMessage.firstCall.args;
        expect(showInfoArgs).to.include("Capture Minimal Diagnostics");
        expect(showInfoArgs).to.include("Capture Full Diagnostics");
    });

    test("Returns undefined when user dismisses the diagnostics mode prompt", async () => {
        mockWindow.showInformationMessage.resolves(undefined);
        mockWindow.withProgress.callsFake(async (_options, task) => {
            return await task(progressReport, new vscode.CancellationTokenSource().token);
        });

        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                showSwiftOutputChannel: mockFn(),
            },
            new TestLogger()
        );

        expect(zipFilePath).to.be.undefined;
    });

    test("Returns a path to a zip file on disk", async () => {
        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                showSwiftOutputChannel: mockFn(),
            },
            new TestLogger()
        );

        expect(zipFilePath).to.match(/\.zip$/);
        const stat = await fs.stat(zipFilePath!);
        expect(stat.isFile()).to.be.true;
        expect(stat.size).to.be.greaterThan(0);
    });

    test("Should capture extension log and per-folder settings", async () => {
        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                showSwiftOutputChannel: mockFn(),
            },
            new TestLogger()
        );
        assert.ok(zipFilePath);

        const entries = await readZipEntries(zipFilePath!);
        expect(entries).to.include("swift-vscode-extension.log");
        expect(entries).to.includeMatch(/^sourcekit-lsp-[0-9.]+\.log$/);
        expect(entries).to.includeMatch(/^defaultPackage-[a-z0-9]+\/settings\.txt$/);
        expect(entries).to.includeMatch(/^dependencies-[a-z0-9]+\/settings\.txt$/);
    });

    test("Should not include source-code diagnostics or sourcekit-lsp diagnose output", async () => {
        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                showSwiftOutputChannel: mockFn(),
            },
            new TestLogger()
        );
        assert.ok(zipFilePath);

        const entries = await readZipEntries(zipFilePath!);
        expect(entries).to.not.includeMatch(/^source-code-diagnostics\.txt$/);
        expect(entries).to.not.includeMatch(/^defaultPackage-[a-z0-9]+\/sourcekit-lsp\//);
        expect(entries).to.not.includeMatch(/^dependencies-[a-z0-9]+\/sourcekit-lsp\//);
    });

    test("Shows an error message and returns undefined on failure", async () => {
        mockWindow.showInformationMessage.resolves("Capture Minimal Diagnostics" as any);
        mockWindow.showErrorMessage.resolves(undefined);

        const badUri = vscode.Uri.file("/nonexistent/path/that/should/not/exist");
        const logger = new TestLogger();
        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: badUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                showSwiftOutputChannel: mockFn(),
            },
            logger
        );

        expect(zipFilePath).to.be.undefined;
        expect(mockWindow.showErrorMessage).to.have.been.calledOnce;
    });

    test("Logs the error when capture fails", async () => {
        mockWindow.showInformationMessage.resolves("Capture Minimal Diagnostics" as any);
        mockWindow.showErrorMessage.resolves(undefined);

        const badUri = vscode.Uri.file("/nonexistent/path/that/should/not/exist");
        const logger = new TestLogger();
        zipFilePath = await captureDiagnostics(
            {
                logFolderUri: badUri,
                globalToolchain: workspaceContext.globalToolchain,
                folders: workspaceContext.folders,
                showSwiftOutputChannel: mockFn(),
            },
            logger
        );

        expect(logger.logs).to.includeMatch(/Failed to capture/);
    });

    tag("large").suite("Capture Full Diagnostics", function () {
        suiteSetup(async () => {
            // Trigger diagnostics to appear
            const diagnosticsFolder = await folderInRootWorkspace("diagnostics", workspaceContext);
            await executeTaskAndWaitForResult(await createBuildAllTask(diagnosticsFolder));
        });

        setup(async () => {
            mockWindow.showInformationMessage.resolves("Capture Full Diagnostics" as any);
        });

        test("Includes source-code diagnostics file for each folder", async () => {
            zipFilePath = await captureDiagnostics(
                {
                    logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                    globalToolchain: workspaceContext.globalToolchain,
                    folders: workspaceContext.folders,
                    showSwiftOutputChannel: mockFn(),
                },
                new TestLogger()
            );
            assert.ok(zipFilePath);

            const entries = await readZipEntries(zipFilePath!);
            expect(entries).to.includeMatch(
                /^diagnostics-[a-z0-9]+\/source-code-diagnostics\.txt$/
            );
        });

        test("Includes sourcekit-lsp diagnose output on Swift 6+", async function () {
            const swiftVersion = workspaceContext.globalToolchainSwiftVersion;
            if (swiftVersion.isLessThan(new Version(6, 0, 0))) {
                this.skip();
            }

            zipFilePath = await captureDiagnostics(
                {
                    logFolderUri: workspaceContext.loggerFactory.logFolderUri,
                    globalToolchain: workspaceContext.globalToolchain,
                    folders: workspaceContext.folders,
                    showSwiftOutputChannel: mockFn(),
                },
                new TestLogger()
            );
            assert.ok(zipFilePath);

            const entries = await readZipEntries(zipFilePath!);
            expect(entries).to.includeMatch(/^dependencies-[a-z0-9]+\/sourcekit-lsp\/.*$/);
        });
    });

    function readZipEntries(zipFilePath: string): Promise<string[]> {
        const { promise, resolve, reject } = unwrapPromise<string[]>();
        yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipFile) => {
            if (err || !zipFile) {
                return reject(err);
            }

            const entries: string[] = [];
            zipFile.readEntry();
            zipFile.on("entry", (entry: { fileName: string }) => {
                entries.push(entry.fileName);
                zipFile.readEntry();
            });
            zipFile.on("end", () => resolve(entries));
            zipFile.on("error", reject);
        });
        return promise;
    }
});
