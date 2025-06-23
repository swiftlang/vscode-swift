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
import { expect } from "chai";
import { SelectedXcodeWatcher } from "../../../src/toolchain/SelectedXcodeWatcher";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";
import {
    instance,
    MockedObject,
    mockFn,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";
import configuration from "../../../src/configuration";
import { Commands } from "../../../src/commands";

suite("Selected Xcode Watcher", () => {
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    let mockOutputChannel: MockedObject<SwiftOutputChannel>;
    const pathConfig = mockGlobalValue(configuration, "path");
    const envConfig = mockGlobalValue(configuration, "swiftEnvironmentVariables");
    const mockWorkspace = mockGlobalObject(vscode, "workspace");
    const mockCommands = mockGlobalObject(vscode, "commands");
    let mockSwiftConfig: MockedObject<vscode.WorkspaceConfiguration>;

    setup(function () {
        // Xcode only exists on macOS, so the SelectedXcodeWatcher is macOS-only.
        if (process.platform !== "darwin") {
            this.skip();
        }

        mockOutputChannel = mockObject<SwiftOutputChannel>({
            appendLine: mockFn(),
        });

        pathConfig.setValue("");

        mockSwiftConfig = mockObject<vscode.WorkspaceConfiguration>({
            inspect: mockFn(),
            update: mockFn(),
        });
        mockWorkspace.getConfiguration.returns(instance(mockSwiftConfig));
    });

    async function run(symLinksOnCallback: (string | undefined)[]) {
        return new Promise<void>(resolve => {
            let ctr = 0;
            const watcher = new SelectedXcodeWatcher(instance(mockOutputChannel), {
                checkIntervalMs: 1,
                xcodeSymlink: async () => {
                    if (ctr >= symLinksOnCallback.length) {
                        watcher.dispose();
                        resolve();
                        return;
                    }
                    const response = symLinksOnCallback[ctr];
                    ctr += 1;
                    return response;
                },
            });
        });
    }

    test("Does nothing when the symlink is undefined", async () => {
        await run([undefined, undefined]);

        expect(mockedVSCodeWindow.showWarningMessage).to.have.not.been.called;
    });

    test("Does nothing when the symlink is identical", async () => {
        await run(["/foo", "/foo"]);

        expect(mockedVSCodeWindow.showWarningMessage).to.have.not.been.called;
    });

    test("Prompts to restart when the symlink changes", async () => {
        await run(["/foo", "/bar"]);

        expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
            "The Swift Extension has detected a change in the selected Xcode. Please reload the extension to apply the changes.",
            "Reload Extensions"
        );
    });

    suite('"swift.path" is out of date', () => {

        setup(() => {
            pathConfig.setValue("/path/to/swift/bin");
        });

        test("Warns that setting is out of date on startup", async () => {

            await run(["/foo", "/foo"]);

            expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
                'The Swift Extension has detected a change in the selected Xcode which does not match the value of your "swift.path" setting. Would you like to update your configured "swift.path" setting?',
                "Remove From Settings",
                "Select Toolchain"
            );
        });

        test("Remove setting", async () => {
            mockedVSCodeWindow.showWarningMessage.resolves("Remove From Settings" as any);

            await run(["/foo", "/foo"]);

            expect(mockSwiftConfig.update.args).to.deep.equal([
                ["path", undefined, vscode.ConfigurationTarget.Global],
                ["path", undefined, vscode.ConfigurationTarget.Workspace],
            ]);
        });

        test("Select toolchain", async () => {
            mockedVSCodeWindow.showWarningMessage.resolves("Select Toolchain" as any);

            await run(["/foo", "/foo"]);

            expect(mockCommands.executeCommand).to.have.been.calledOnceWith(Commands.SELECT_TOOLCHAIN);
        });

        test("Warns that setting is out of date", async () => {
            envConfig.setValue({ DEVELOPER_DIR: "/bar" });
            await run([undefined, "/bar", "/bar"]);

            expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
                'The Swift Extension has detected a change in the selected Xcode which does not match the value of your "swift.path" setting. Would you like to update your configured "swift.path" setting?',
                "Remove From Settings",
                "Select Toolchain"
            );
        });
    });

    suite("DEVELOPER_DIR is out of date", () => {

        setup(() => {
            pathConfig.setValue("/path/to/swift/bin");
            envConfig.setValue({ DEVELOPER_DIR: "/bar" });
        });

        test("Warns that environment is out of date on startup", async () => {
            pathConfig.setValue("/path/to/swift/bin");

            await run(["/foo", "/foo"]);

            expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
                'The Swift Extension has detected a change in the selected Xcode which does not match the value of your DEVELOPER_DIR in the "swift.swiftEnvironmentVariables" setting. Would you like to update your configured "swift.swiftEnvironmentVariables" setting?',
                "Remove From Settings",
                "Select Toolchain"
            );
        });

        test("Remove setting", async () => {
            mockedVSCodeWindow.showWarningMessage.resolves("Remove From Settings" as any);

            await run(["/foo", "/foo"]);

            expect(mockSwiftConfig.update.args).to.deep.equal([
                ["path", undefined, vscode.ConfigurationTarget.Global],
                ["path", undefined, vscode.ConfigurationTarget.Workspace],
            ]);
        });

        test("Select toolchain", async () => {
            mockedVSCodeWindow.showWarningMessage.resolves("Select Toolchain" as any);

            await run(["/foo", "/foo"]);

            expect(mockCommands.executeCommand).to.have.been.calledOnceWith(Commands.SELECT_TOOLCHAIN);
        });

        test("Warns that setting is out of date", async () => {
            await run(["/bar", "/foo", "/foo"]);

            expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
                'The Swift Extension has detected a change in the selected Xcode which does not match the value of your DEVELOPER_DIR in the "swift.swiftEnvironmentVariables" setting. Would you like to update your configured "swift.swiftEnvironmentVariables" setting?',
                "Remove From Settings",
                "Select Toolchain"
            );
        });
    });
});
