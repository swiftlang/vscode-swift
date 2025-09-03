//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
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
import {
    mockObject,
    mockGlobalValue,
    MockedObject,
    instance,
    mockGlobalObject,
} from "../MockUtils";
import { SwiftEnvironmentVariablesManager, SwiftTerminalProfileProvider } from "@src/terminal";
import configuration from "@src/configuration";

suite("Terminal", () => {
    const mockedPlatform = mockGlobalValue(process, "platform");
    const enableTerminalEnvironmentConfig = mockGlobalValue(
        configuration,
        "enableTerminalEnvironment"
    );
    const pathConfig = mockGlobalValue(configuration, "path");
    const swiftEnvironmentVariablesConfig = mockGlobalValue(
        configuration,
        "swiftEnvironmentVariables"
    );

    setup(() => {
        // Set default platform to non-Windows for most tests
        mockedPlatform.setValue("darwin");

        // Default configuration values
        enableTerminalEnvironmentConfig.setValue(true);
        pathConfig.setValue("/path/to/swift");
        swiftEnvironmentVariablesConfig.setValue({ SWIFT_ENV: "test" });
    });

    suite("SwiftEnvironmentVariablesManager", () => {
        let mockedExtensionContext: MockedObject<vscode.ExtensionContext>;
        let mockedEnvironmentVariableCollection: MockedObject<vscode.GlobalEnvironmentVariableCollection>;
        let mockedDisposable: MockedObject<vscode.Disposable>;

        const mockedWorkspace = mockGlobalObject(vscode, "workspace");

        setup(() => {
            // Set default platform to non-Windows for most tests
            mockedPlatform.setValue("darwin");

            mockedEnvironmentVariableCollection =
                mockObject<vscode.GlobalEnvironmentVariableCollection>({
                    clear: () => {},
                    prepend: () => {},
                    replace: () => {},
                    getScoped: (_scope: vscode.EnvironmentVariableScope) =>
                        instance(mockedEnvironmentVariableCollection),
                });

            mockedExtensionContext = mockObject<vscode.ExtensionContext>({
                environmentVariableCollection: instance(mockedEnvironmentVariableCollection),
            });

            mockedDisposable = mockObject<vscode.Disposable>({
                dispose: () => {},
            });

            mockedWorkspace.onDidChangeConfiguration.returns(instance(mockedDisposable));
        });

        test("constructor initializes and calls update", () => {
            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));
            expect(mockedEnvironmentVariableCollection.clear).to.have.been.calledOnce;
            expect(mockedEnvironmentVariableCollection.prepend).to.have.been.calledWith(
                "PATH",
                "/path/to/swift:"
            );
            expect(mockedEnvironmentVariableCollection.replace).to.have.been.calledWith(
                "SWIFT_ENV",
                "test"
            );
        });

        test("constructor registers configuration change listener", () => {
            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            expect(mockedWorkspace.onDidChangeConfiguration).to.have.been.calledOnce;
        });

        test("update does nothing when enableTerminalEnvironment is false", () => {
            enableTerminalEnvironmentConfig.setValue(false);

            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            expect(mockedEnvironmentVariableCollection.clear).to.have.been.calledOnce;
            expect(mockedEnvironmentVariableCollection.prepend).to.not.have.been.called;
            expect(mockedEnvironmentVariableCollection.replace).to.not.have.been.called;
        });

        test("update handles empty path", () => {
            pathConfig.setValue("");

            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            expect(mockedEnvironmentVariableCollection.clear).to.have.been.calledOnce;
            expect(mockedEnvironmentVariableCollection.prepend).to.not.have.been.called;
            expect(mockedEnvironmentVariableCollection.replace).to.have.been.calledWith(
                "SWIFT_ENV",
                "test"
            );
        });

        test("update handles empty environment variables", () => {
            swiftEnvironmentVariablesConfig.setValue({});

            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            expect(mockedEnvironmentVariableCollection.clear).to.have.been.calledOnce;
            expect(mockedEnvironmentVariableCollection.prepend).to.have.been.calledWith(
                "PATH",
                "/path/to/swift:"
            );
            expect(mockedEnvironmentVariableCollection.replace).to.not.have.been.called;
        });

        test("update uses Windows path separator on Windows", () => {
            mockedPlatform.setValue("win32");

            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            expect(mockedEnvironmentVariableCollection.prepend).to.have.been.calledWith(
                "PATH",
                "/path/to/swift;"
            );
        });

        test("dispose clears environment variables and disposes subscriptions", () => {
            const manager = new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            mockedEnvironmentVariableCollection.clear.resetHistory();

            manager.dispose();

            expect(mockedEnvironmentVariableCollection.clear).to.have.been.calledOnce;
            expect(mockedDisposable.dispose).to.have.been.calledOnce;
        });

        test("onDidChangeConfiguration calls update", () => {
            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            const callback = mockedWorkspace.onDidChangeConfiguration.getCall(0).args[0];

            mockedEnvironmentVariableCollection.clear.resetHistory();

            callback({ affectsConfiguration: (section: string) => section === "swift.path" });

            expect(mockedEnvironmentVariableCollection.clear).to.have.been.calledOnce;

            mockedEnvironmentVariableCollection.clear.resetHistory();

            callback({ affectsConfiguration: (section: string) => section === "other.setting" });

            expect(mockedEnvironmentVariableCollection.clear).to.not.have.been.called;
        });

        test("onDidChangeConfiguration calls update", () => {
            // Create the manager
            new SwiftEnvironmentVariablesManager(instance(mockedExtensionContext));

            // Get the callback
            const callback = mockedWorkspace.onDidChangeConfiguration.getCall(0).args[0];

            // Reset call history
            mockedEnvironmentVariableCollection.clear.resetHistory();

            // Call the callback with an event that affects swift.path
            callback({ affectsConfiguration: (section: string) => section === "swift.path" });

            // Verify that clear was called again
            expect(mockedEnvironmentVariableCollection.clear).to.have.been.calledOnce;

            // Reset call history
            mockedEnvironmentVariableCollection.clear.resetHistory();

            // Call the callback with an event that does not affect swift.path
            callback({ affectsConfiguration: (section: string) => section === "other.setting" });

            // Verify that clear was not called
            expect(mockedEnvironmentVariableCollection.clear).to.not.have.been.called;
        });
    });

    suite("SwiftTerminalProfileProvider", () => {
        // Mock configuration values
        const mockedWindow = mockGlobalObject(vscode, "window");
        let mockedTerminal: MockedObject<vscode.Terminal>;
        let mockedDisposable: MockedObject<vscode.Disposable>;

        setup(() => {
            // Create mocks
            mockedTerminal = mockObject<vscode.Terminal>({
                sendText: () => {},
            });

            mockedDisposable = mockObject<vscode.Disposable>({
                dispose: () => {},
            });

            mockedWindow.onDidOpenTerminal.returns(instance(mockedDisposable));
            mockedWindow.registerTerminalProfileProvider.returns(instance(mockedDisposable));
        });

        test("provideTerminalProfile returns correct profile with environment variables", () => {
            const provider = new SwiftTerminalProfileProvider();
            const profile = provider.provideTerminalProfile();

            expect(profile).to.be.instanceOf(vscode.TerminalProfile);
            expect((profile as vscode.TerminalProfile).options.name).to.equal("Swift Terminal");
            expect((profile as vscode.TerminalProfile).options.iconPath).to.be.instanceOf(
                vscode.ThemeIcon
            );

            // Access env property safely with type assertion
            const options = (profile as vscode.TerminalProfile).options;
            const env = options as unknown as { env: Record<string, string> };
            expect(env.env).to.deep.equal({ SWIFT_ENV: "test" });
        });

        test("provideTerminalProfile sets up terminal when enableTerminalEnvironment is false", () => {
            enableTerminalEnvironmentConfig.setValue(false);

            const provider = new SwiftTerminalProfileProvider();
            const profile = provider.provideTerminalProfile();
            expect(profile).to.exist;
            expect(mockedWindow.onDidOpenTerminal).to.have.been.calledOnce;

            const callback = mockedWindow.onDidOpenTerminal.getCall(0).args[0];
            callback(instance(mockedTerminal));

            expect(mockedDisposable.dispose).to.have.been.calledOnce;
            expect(mockedTerminal.sendText).to.have.been.calledWith(
                "export PATH=/path/to/swift:$PATH"
            );
        });

        test("provideTerminalProfile uses Windows path separator on Windows", () => {
            mockedPlatform.setValue("win32");
            enableTerminalEnvironmentConfig.setValue(false);

            const provider = new SwiftTerminalProfileProvider();
            const profile = provider.provideTerminalProfile();
            expect(profile).to.exist;

            const callback = mockedWindow.onDidOpenTerminal.getCall(0).args[0];
            callback(instance(mockedTerminal));

            expect(mockedTerminal.sendText).to.have.been.calledWith(
                "export PATH=/path/to/swift;$PATH"
            );
        });

        test("register calls registerTerminalProfileProvider", () => {
            const disposable = SwiftTerminalProfileProvider.register();

            expect(mockedWindow.registerTerminalProfileProvider).to.have.been.calledOnce;
            expect(mockedWindow.registerTerminalProfileProvider.getCall(0).args[0]).to.equal(
                "swift.terminalProfile"
            );
            expect(
                mockedWindow.registerTerminalProfileProvider.getCall(0).args[1]
            ).to.be.instanceOf(SwiftTerminalProfileProvider);

            expect(disposable).to.equal(instance(mockedDisposable));
        });
    });
});
