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
import { expect } from "chai";
import * as mockFS from "mock-fs";
import type * as FileSystem from "mock-fs/lib/filesystem";
import { SinonFakeTimers, match, useFakeTimers } from "sinon";
import * as vscode from "vscode";

import { InternalSwiftExtensionApi } from "@src/InternalSwiftExtensionApi";
import { ToolchainManager } from "@src/SwiftExtensionApi";
import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { SelectedXcodeWatcher } from "@src/toolchain/SelectedXcodeWatcher";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { captitalizeFirstLetter } from "@src/utilities/utilities";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";

suite("Selected Xcode Watcher", () => {
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    let mockSwiftExtensionApi: MockedObject<InternalSwiftExtensionApi>;
    let mockToolchain: MockedObject<SwiftToolchain>;
    let mockLogger: MockedObject<SwiftLogger>;
    const pathConfig = mockGlobalValue(configuration, "path");
    const envConfig = mockGlobalValue(configuration, "swiftEnvironmentVariables");
    const mockWorkspace = mockGlobalObject(vscode, "workspace");
    let mockSwiftConfig: MockedObject<vscode.WorkspaceConfiguration>;
    let timers: SinonFakeTimers;

    setup(function () {
        mockFS();

        mockLogger = mockObject<SwiftLogger>({
            debug: mockFn(),
            info: mockFn(),
        });
        mockToolchain = mockObject<SwiftToolchain>({ manager: "unknown" });
        const mockWorkspaceContext = mockObject<WorkspaceContext>({
            globalToolchain: instance(mockToolchain),
        });
        mockSwiftExtensionApi = mockObject<InternalSwiftExtensionApi>({
            logger: instance(mockLogger),
            reloadWorkspaceContext: mockFn(),
            workspaceContext: instance(mockWorkspaceContext),
        });

        pathConfig.setValue("");
        envConfig.setValue({});

        mockSwiftConfig = mockObject<vscode.WorkspaceConfiguration>({
            inspect: mockFn(),
            update: mockFn(),
        });
        mockWorkspace.getConfiguration.returns(instance(mockSwiftConfig));

        timers = useFakeTimers();
    });

    teardown(() => {
        mockFS.restore();
        timers.restore();
    });

    async function run(platform: NodeJS.Platform, symLinksOnCallback: (string | undefined)[]) {
        const watcher = new SelectedXcodeWatcher(instance(mockSwiftExtensionApi), platform);
        async function runUntilNextCheck(): Promise<void> {
            // Allow some time for any Promises to complete.
            await timers.tickAsync(1);
            await timers.tickAsync(1);
            await timers.tickAsync(1);
            // Advance time to the next check
            await timers.nextAsync();
            // Allow some time for any Promises to complete.
            await timers.tickAsync(1);
            await timers.tickAsync(1);
            await timers.tickAsync(1);
        }

        try {
            for (const symlinkPath of symLinksOnCallback) {
                const mockFSConfig: FileSystem.DirectoryItems = {};
                if (symlinkPath) {
                    mockFSConfig[SelectedXcodeWatcher.XCODE_SYMLINK_PATH] = mockFS.symlink({
                        path: symlinkPath,
                    });
                }
                mockFS(mockFSConfig);
                await runUntilNextCheck();
            }
        } finally {
            watcher.dispose();
            expect(timers.countTimers()).to.equal(0, "No timers should be present after dispose()");
        }
    }

    test("ignores all events on Windows", async () => {
        await run("win32", [
            "C:\\Program Files\\Xcode\\Contents\\Developer",
            "C:\\Program Files\\Xcode-2\\Contents\\Developer",
        ]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
        expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
    });

    test("ignores all events on Linux", async () => {
        await run("linux", ["/opt/Xcode/Contents/Developer", "/opt/Xcode-2/Contents/Developer"]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
        expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
    });

    test("does nothing when the symlink changes from undefined to defined", async () => {
        await run("darwin", [undefined, "/Applications/Xcode.app/Contents/Developer"]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.not.been.called;
        expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
    });

    test("does nothing when the symlink switches between undefined and defined", async () => {
        await run("darwin", [
            "/Applications/Xcode.app/Contents/Developer",
            undefined,
            "/Applications/Xcode.app/Contents/Developer",
            undefined,
            "/Applications/Xcode.app/Contents/Developer",
        ]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.not.been.called;
        expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
    });

    test("does nothing when the symlink remains the same", async () => {
        await run("darwin", [
            "/Applications/Xcode.app/Contents/Developer",
            "/Applications/Xcode.app/Contents/Developer",
            "/Applications/Xcode.app/Contents/Developer",
        ]);

        expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.not.been.called;
        expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
    });

    suite("No Active Toolchain", () => {
        setup(() => {
            mockSwiftExtensionApi.workspaceContext = undefined;
        });

        test("detects when the path to Xcode changes", async () => {
            await run("darwin", [
                "/Applications/Xcode.app/Contents/Developer",
                "/Applications/Xcode-2.app/Contents/Developer",
            ]);

            expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.been.calledOnce;
            expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
        });

        test("detects when the path to Xcode changes and DEVELOPER_DIR is set", async () => {
            envConfig.setValue({
                DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
            });
            await run("darwin", [
                "/Applications/Xcode.app/Contents/Developer",
                "/Applications/Xcode-2.app/Contents/Developer",
            ]);

            expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
            expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWith(
                match(
                    "The Swift Extension has detected a change in the selected Xcode which does not match the value of your DEVELOPER_DIR"
                )
            );
        });

        test("detects when the path to Xcode changes to the same value as DEVELOPER_DIR", async () => {
            envConfig.setValue({
                DEVELOPER_DIR: "/Applications/Xcode-2.app/Contents/Developer",
            });
            await run("darwin", [
                "/Applications/Xcode.app/Contents/Developer",
                "/Applications/Xcode-2.app/Contents/Developer",
            ]);

            expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
            expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
        });

        test("detects when the path to Xcode changes and swift.path is set", async () => {
            pathConfig.setValue(
                "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin"
            );
            await run("darwin", [
                "/Applications/Xcode.app/Contents/Developer",
                "/Applications/Xcode-2.app/Contents/Developer",
            ]);

            expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.been.calledOnce;
            expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWith(
                match(
                    'The Swift Extension has detected a change in the selected Xcode which does not match the value of your "swift.path" setting.'
                )
            );
        });

        test("detects when the path to Xcode changes to the same value as swift.path", async () => {
            pathConfig.setValue(
                "/Applications/Xcode-2.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin"
            );
            await run("darwin", [
                "/Applications/Xcode.app/Contents/Developer",
                "/Applications/Xcode-2.app/Contents/Developer",
            ]);

            expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.been.calledOnce;
            expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
        });
    });

    function createSuiteForXcrunManagedToolchain(options: { swiftPath: string }): void {
        suite(`Xcrun Managed Toolchain - "swift.path": "${options.swiftPath}"`, () => {
            setup(() => {
                pathConfig.setValue(options.swiftPath);
                mockToolchain.manager = "xcrun";
            });

            test("detects when the path to Xcode changes", async () => {
                await run("darwin", [
                    "/Applications/Xcode.app/Contents/Developer",
                    "/Applications/Xcode-2.app/Contents/Developer",
                ]);

                expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.have.been.calledOnce;
                expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
            });

            test("detects when the path to Xcode changes and DEVELOPER_DIR is set", async () => {
                envConfig.setValue({
                    DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
                });
                await run("darwin", [
                    "/Applications/Xcode.app/Contents/Developer",
                    "/Applications/Xcode-2.app/Contents/Developer",
                ]);

                expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
                expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWith(
                    match(
                        "The Swift Extension has detected a change in the selected Xcode which does not match the value of your DEVELOPER_DIR"
                    )
                );
            });

            test("detects when the path to Xcode changes to the same value as DEVELOPER_DIR", async () => {
                envConfig.setValue({
                    DEVELOPER_DIR: "/Applications/Xcode-2.app/Contents/Developer",
                });
                await run("darwin", [
                    "/Applications/Xcode.app/Contents/Developer",
                    "/Applications/Xcode-2.app/Contents/Developer",
                ]);

                expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
                expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
            });
        });
    }
    createSuiteForXcrunManagedToolchain({ swiftPath: "" });
    createSuiteForXcrunManagedToolchain({ swiftPath: "/usr/bin" });

    // Toolchain managers like swiftly and swiftenv only use Xcode for its SDK via the DEVELOPER_DIR setting
    function createSuiteForNonXcrunToolchain(manager: ToolchainManager): void {
        suite(`${captitalizeFirstLetter(manager)} Managed Toolchain`, () => {
            setup(() => {
                mockToolchain.manager = manager;
            });

            test("does nothing when the path to Xcode changes", async () => {
                await run("darwin", [
                    "/Applications/Xcode.app/Contents/Developer",
                    "/Applications/Xcode-2.app/Contents/Developer",
                ]);

                expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
                expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
            });

            test("detects when the path to Xcode changes and DEVELOPER_DIR is set", async () => {
                envConfig.setValue({
                    DEVELOPER_DIR: "/Applications/Xcode.app/Contents/Developer",
                });
                await run("darwin", [
                    "/Applications/Xcode.app/Contents/Developer",
                    "/Applications/Xcode-2.app/Contents/Developer",
                ]);

                expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
                expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWith(
                    match(
                        "The Swift Extension has detected a change in the selected Xcode which does not match the value of your DEVELOPER_DIR"
                    )
                );
            });

            test("detects when the path to Xcode changes to the same value as DEVELOPER_DIR", async () => {
                envConfig.setValue({
                    DEVELOPER_DIR: "/Applications/Xcode-2.app/Contents/Developer",
                });
                await run("darwin", [
                    "/Applications/Xcode.app/Contents/Developer",
                    "/Applications/Xcode-2.app/Contents/Developer",
                ]);

                expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
                expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
            });

            test("does nothing when the path to Xcode changes and swift.path is set", async () => {
                pathConfig.setValue(
                    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin"
                );
                await run("darwin", [
                    "/Applications/Xcode.app/Contents/Developer",
                    "/Applications/Xcode-2.app/Contents/Developer",
                ]);

                expect(mockSwiftExtensionApi.reloadWorkspaceContext).to.not.have.been.called;
                expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
            });
        });
    }
    createSuiteForNonXcrunToolchain("swiftly");
    createSuiteForNonXcrunToolchain("swiftenv");
});
