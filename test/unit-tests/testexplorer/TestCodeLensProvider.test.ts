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
import * as sinon from "sinon";
import * as vscode from "vscode";

import { TestCodeLensProvider } from "@src/TestExplorer/TestCodeLensProvider";
import { TestExplorer } from "@src/TestExplorer/TestExplorer";
import * as TestUtils from "@src/TestExplorer/TestUtils";
import configuration from "@src/configuration";

import { instance, mockObject } from "../../MockUtils";

suite("TestCodeLensProvider", () => {
    let sandbox: sinon.SinonSandbox;
    let testExplorer: TestExplorer;
    let testItems: vscode.TestItem[];
    let document: vscode.TextDocument;
    let configStub: sinon.SinonStub;
    let flattenStub: sinon.SinonStub;
    let registerCodeLensProviderStub: sinon.SinonStub;
    let codeLensProvider: TestCodeLensProvider;

    const token = () => new vscode.CancellationTokenSource().token;

    setup(() => {
        sandbox = sinon.createSandbox();

        testItems = [
            createTestItem("test1", "Test 1", "/path/to/file1.swift", new vscode.Range(0, 0, 1, 0)),
            createTestItem("test2", "Test 2", "/path/to/file2.swift", new vscode.Range(2, 0, 3, 0)),
            createTestItem("test3", "Test 3", "/path/to/file1.swift", new vscode.Range(4, 0, 5, 0)),
            createTestItem("test4", "Test 4", "/path/to/file1.swift", undefined),
        ];

        const testItemCollection = mockObject<vscode.TestItemCollection>({
            forEach: sandbox.stub().callsFake((callback: (item: vscode.TestItem) => void) => {
                testItems.forEach(item => callback(item));
            }),
            get: sandbox.stub(),
            delete: sandbox.stub(),
            replace: sandbox.stub(),
            size: testItems.length,
            add: sandbox.stub(),
        });

        const testController = mockObject<vscode.TestController>({
            items: testItemCollection,
            createTestItem: sandbox.stub(),
        });

        const onTestItemsDidChangeStub = sandbox.stub();
        onTestItemsDidChangeStub.returns({ dispose: sandbox.stub() });

        testExplorer = mockObject<TestExplorer>({
            controller: instance(testController),
            onTestItemsDidChange: onTestItemsDidChangeStub,
        }) as unknown as TestExplorer; // allows for a partial mock of TestExplorer

        document = instance(
            mockObject<vscode.TextDocument>({
                uri: vscode.Uri.file("/path/to/file1.swift"),
            })
        );

        registerCodeLensProviderStub = sandbox
            .stub(vscode.languages, "registerCodeLensProvider")
            .returns({ dispose: sandbox.stub() });

        configStub = sandbox.stub(configuration, "showTestCodeLenses");
        flattenStub = sandbox.stub(TestUtils, "flattenTestItemCollection").returns(testItems);
        codeLensProvider = new TestCodeLensProvider(testExplorer);
    });

    teardown(() => {
        sandbox.restore();
        codeLensProvider.dispose();
    });

    function createTestItem(
        id: string,
        label: string,
        filePath: string,
        range: vscode.Range | undefined
    ): vscode.TestItem {
        return instance(
            mockObject<vscode.TestItem>({
                id,
                label,
                uri: filePath ? vscode.Uri.file(filePath) : undefined,
                range,
            })
        );
    }

    test("constructor should register event handlers and code lens provider", () => {
        expect((testExplorer.onTestItemsDidChange as sinon.SinonStub).calledOnce).to.be.true;
        expect(registerCodeLensProviderStub.calledOnce).to.be.true;
        expect(registerCodeLensProviderStub.firstCall.args[0]).to.deep.equal({
            language: "swift",
            scheme: "file",
        });
        expect(registerCodeLensProviderStub.firstCall.args[1]).to.equal(codeLensProvider);
    });

    test("provideCodeLenses should return empty array when showTestCodeLenses is false", async () => {
        configStub.value(false);

        const result = await codeLensProvider.provideCodeLenses(document, token());

        expect(result).to.be.an("array").that.is.empty;
        expect(flattenStub.called).to.be.false;
    });

    test("provideCodeLenses should return empty array when showTestCodeLenses is an empty array", async () => {
        configStub.value([]);

        const result = await codeLensProvider.provideCodeLenses(document, token());

        expect(result).to.be.an("array").that.is.empty;
        expect(flattenStub.called).to.be.false;
    });

    test("provideCodeLenses should filter test items by document URI", async () => {
        configStub.value(true);

        const result = await codeLensProvider.provideCodeLenses(document, token());

        // Should only include test items with matching URI (test1 and test3)
        expect(result).to.be.an("array").with.lengthOf(6); // 2 test items * 3 lens types
        expect(result).to.not.be.null;
        expect(result).to.not.be.undefined;

        // Verify that the code lenses are for the correct test items
        const testItemIds = result!.map(
            lens => (lens.command?.arguments?.[0] as vscode.TestItem).id
        );
        expect(testItemIds).to.include.members([
            "test1",
            "test1",
            "test1",
            "test3",
            "test3",
            "test3",
        ]);
        expect(testItemIds).to.not.include.members(["test2", "test4"]);
    });

    test("provideCodeLenses should create code lenses for all types when showTestCodeLenses is true", async () => {
        configStub.value(true);

        const result = await codeLensProvider.provideCodeLenses(document, token());

        // Should create 3 lens types (run, debug, coverage) for each matching test item (test1 and test3)
        expect(result).to.be.an("array").with.lengthOf(6);
        expect(result).to.not.be.null;
        expect(result).to.not.be.undefined;

        const commands = result!.map((lens: vscode.CodeLens) => lens.command?.command);
        expect(commands).to.include.members([
            "swift.runTest",
            "swift.runTest",
            "swift.debugTest",
            "swift.debugTest",
            "swift.runTestWithCoverage",
            "swift.runTestWithCoverage",
        ]);
    });

    test("provideCodeLenses should create code lenses only for specified types", async () => {
        configStub.value(["run", "debug"]);

        const result = await codeLensProvider.provideCodeLenses(document, token());

        // Should create 2 lens types (run, debug) for each matching test item (test1 and test3)
        expect(result).to.be.an("array").with.lengthOf(4);
        expect(result).to.not.be.null;
        expect(result).to.not.be.undefined;

        const commands = result!.map((lens: vscode.CodeLens) => lens.command?.command);
        expect(commands).to.include.members([
            "swift.runTest",
            "swift.runTest",
            "swift.debugTest",
            "swift.debugTest",
        ]);
        expect(commands).to.not.include("swift.runTestWithCoverage");
    });

    test("provideCodeLenses should return empty array for test items without a range", async () => {
        configStub.value(true);

        // Create a document that matches the URI of the test item without a range
        const noRangeDocument = instance(
            mockObject<vscode.TextDocument>({
                uri: vscode.Uri.file("/path/to/file1.swift"),
            })
        );

        // Make flattenStub return only the test item without a range
        flattenStub.returns([testItems[3]]); // test4 has no range

        const result = await codeLensProvider.provideCodeLenses(noRangeDocument, token());

        expect(result).to.be.an("array").that.is.empty;
    });

    test("provideCodeLenses should create code lenses for all types when config is true", async () => {
        configStub.value(true);

        // Create a document that matches the URI of the test item with a range
        const singleItemDocument = instance(
            mockObject<vscode.TextDocument>({
                uri: vscode.Uri.file("/path/to/file1.swift"),
            })
        );

        // Make flattenStub return only one test item with a range
        flattenStub.returns([testItems[0]]); // test1 has a range

        const result = await codeLensProvider.provideCodeLenses(singleItemDocument, token());

        // Should create 3 lens types (run, debug, coverage)
        expect(result).to.be.an("array").with.lengthOf(3);
        expect(result).to.not.be.null;
        expect(result).to.not.be.undefined;

        const commands = result!.map((lens: vscode.CodeLens) => lens.command?.command);
        expect(commands).to.include.members([
            "swift.runTest",
            "swift.debugTest",
            "swift.runTestWithCoverage",
        ]);
    });

    test("provideCodeLenses should create code lenses only for specified types", async () => {
        configStub.value(["run"]);

        // Create a document that matches the URI of the test item with a range
        const singleItemDocument = instance(
            mockObject<vscode.TextDocument>({
                uri: vscode.Uri.file("/path/to/file1.swift"),
            })
        );

        // Make flattenStub return only one test item with a range
        flattenStub.returns([testItems[0]]); // test1 has a range

        const result = await codeLensProvider.provideCodeLenses(singleItemDocument, token());

        // Should create 1 lens type (run)
        expect(result).to.be.an("array").with.lengthOf(1);

        // Ensure result is not null or undefined before accessing its properties
        expect(result).to.not.be.null;
        expect(result).to.not.be.undefined;
        expect(result![0].command?.command).to.equal("swift.runTest");
    });
});
