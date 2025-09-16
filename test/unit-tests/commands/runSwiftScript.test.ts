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
import { expect } from "chai";
import { beforeEach } from "mocha";
import { match, stub } from "sinon";
import * as vscode from "vscode";

import { runSwiftScript } from "@src/commands/runSwiftScript";
import configuration from "@src/configuration";
import { TaskManager } from "@src/tasks/TaskManager";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import { instance, mockFn, mockGlobalObject, mockGlobalValue, mockObject } from "../../MockUtils";

suite("runSwiftScript Test Suite", () => {
    const mockTaskManager = mockObject<TaskManager>({ executeTaskAndWait: stub().resolves() });
    const mockToolchain = mockObject<SwiftToolchain>({
        getToolchainExecutable: () => "/usr/bin/swift",
        swiftVersion: new Version(6, 0, 0),
        buildFlags: instance(
            mockObject<BuildFlags>({
                withAdditionalFlags: mockFn(s => s.callsFake(args => args)),
            })
        ),
    });

    function createMockTextDocument(
        options: {
            isUntitled?: boolean;
        } = {}
    ) {
        const isUntitled = options.isUntitled ?? false;
        const baseDocument = {
            getText: stub().returns('print("Hello, World!")'),
            uri: vscode.Uri.file("/path/to/test.swift"),
            languageId: "swift",
            isUntitled,
        };

        // Add properties specific to saved documents
        if (!isUntitled) {
            return mockObject<vscode.TextDocument>({
                ...baseDocument,
                fileName: "test.swift",
                save: stub().resolves(true),
            });
        }

        return mockObject<vscode.TextDocument>(baseDocument);
    }

    beforeEach(() => {
        mockTaskManager.executeTaskAndWait.resetHistory();
    });

    test("Executes runTask command with a saved document", async () => {
        await runSwiftScript(
            instance(createMockTextDocument()),
            instance(mockTaskManager),
            instance(mockToolchain)
        );

        expect(mockTaskManager.executeTaskAndWait).to.have.been.calledOnceWith(
            match.has("detail", "swift -swift-version 6 test.swift")
        );
    });

    test("Executes runTask command with an unsaved document", async () => {
        await runSwiftScript(
            instance(createMockTextDocument({ isUntitled: true })),
            instance(mockTaskManager),
            instance(mockToolchain)
        );

        expect(mockTaskManager.executeTaskAndWait).to.have.been.calledOnceWith(
            match.has("detail", match(/^swift -swift-version 6 /))
        );
    });

    suite("User Configuration", () => {
        const config = mockGlobalValue(configuration, "scriptSwiftLanguageVersion");
        const mockWindow = mockGlobalObject(vscode, "window");

        test("Executes run task with the users chosen swift version", async () => {
            config.setValue(() => "5");

            await runSwiftScript(
                instance(createMockTextDocument()),
                instance(mockTaskManager),
                instance(mockToolchain)
            );

            expect(mockTaskManager.executeTaskAndWait).to.have.been.calledOnceWith(
                match.has("detail", "swift -swift-version 5 test.swift")
            );
        });

        test("Prompts for the users desired swift version", async () => {
            config.setValue(() => "Ask Every Run");
            const selectedItem = { value: "6", label: "Swift 6" };
            mockWindow.showQuickPick.resolves(selectedItem);

            await runSwiftScript(
                instance(createMockTextDocument()),
                instance(mockTaskManager),
                instance(mockToolchain)
            );

            expect(mockTaskManager.executeTaskAndWait).to.have.been.calledOnceWith(
                match.has("detail", "swift -swift-version 6 test.swift")
            );
        });

        test("Exists when the user cancels the prompt", async () => {
            config.setValue(() => "Ask Every Run");
            mockWindow.showQuickPick.resolves(undefined);

            await runSwiftScript(
                instance(createMockTextDocument()),
                instance(mockTaskManager),
                instance(mockToolchain)
            );

            expect(mockTaskManager.executeTaskAndWait).to.not.have.been.called;
        });
    });
});
