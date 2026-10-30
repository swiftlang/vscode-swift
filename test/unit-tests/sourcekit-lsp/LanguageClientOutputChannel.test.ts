//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";
import { match } from "sinon";
import * as vscode from "vscode";

import { LanguageClientOutputChannel } from "@src/sourcekit-lsp/client/LanguageClientOutputChannel";
import { Disposable } from "@src/utilities/Disposable";

import { MockedObject, instance, mockFn, mockGlobalObject, mockObject } from "../../MockUtils";

suite("LanguageClientOutputChannel Suite", () => {
    const mockedWorkspace = mockGlobalObject(vscode, "workspace");
    let channel: MockedObject<vscode.OutputChannel>;
    let configuration: MockedObject<vscode.WorkspaceConfiguration>;
    let outputChannel: LanguageClientOutputChannel;

    setup(() => {
        channel = mockObject<vscode.OutputChannel>({
            name: "SourceKit Language Server",
            appendLine: mockFn(),
            dispose: mockFn(),
        });
        configuration = mockObject<vscode.WorkspaceConfiguration>({
            get: mockFn(s => s.returns("off")),
        });
        mockedWorkspace.getConfiguration.returns(instance(configuration));
        mockedWorkspace.onDidChangeConfiguration.returns(
            instance(mockObject<Disposable>({ dispose: mockFn() }))
        );
    });

    teardown(() => {
        outputChannel?.dispose();
    });

    function changeTraceSetting(value: string): void {
        configuration.get.returns(value);
        const listener = mockedWorkspace.onDidChangeConfiguration.getCall(0).args[0];
        listener({
            affectsConfiguration: (section: string) =>
                section === "swift.sourcekit-lsp.trace.server",
        });
    }

    test("writes the client's messages as vscode-languageclient 9 did", () => {
        outputChannel = new LanguageClientOutputChannel(instance(channel), "swift.sourcekit-lsp");

        outputChannel.info("Server started");
        outputChannel.warn("Slow response");

        expect(channel.appendLine).to.have.been.calledWith(
            match(/^\[Info {2}- .+\] Server started$/)
        );
        expect(channel.appendLine).to.have.been.calledWith(
            match(/^\[Warn {2}- .+\] Slow response$/)
        );
    });

    test("uses the Trace log level only while trace.server is on", () => {
        configuration.get.withArgs("trace.server").returns("messages");
        outputChannel = new LanguageClientOutputChannel(instance(channel), "swift.sourcekit-lsp");
        expect(outputChannel.logLevel).to.equal(vscode.LogLevel.Trace);

        configuration.get.withArgs("trace.server").returns("off");
        const off = new LanguageClientOutputChannel(instance(channel), "swift.sourcekit-lsp");
        expect(off.logLevel).to.equal(vscode.LogLevel.Info);
        off.dispose();
    });

    test("tells the client when trace.server changes", () => {
        outputChannel = new LanguageClientOutputChannel(instance(channel), "swift.sourcekit-lsp");
        const levels: vscode.LogLevel[] = [];
        outputChannel.onDidChangeLogLevel(level => levels.push(level));

        changeTraceSetting("verbose");
        changeTraceSetting("messages");
        changeTraceSetting("off");

        expect(levels).to.deep.equal([vscode.LogLevel.Trace, vscode.LogLevel.Info]);
        expect(outputChannel.logLevel).to.equal(vscode.LogLevel.Info);
    });
});
