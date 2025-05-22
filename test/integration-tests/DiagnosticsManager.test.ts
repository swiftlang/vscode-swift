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
import * as vscode from "vscode";
import { SwiftToolchain } from "../../src/toolchain/toolchain";
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../utilities/tasks";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { testAssetUri, testSwiftTask } from "../fixtures";
import { createBuildAllTask } from "../../src/tasks/SwiftTaskProvider";
import { DiagnosticsManager } from "../../src/DiagnosticsManager";
import { FolderContext } from "../../src/FolderContext";
import { Version } from "../../src/utilities/version";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
} from "./utilities/testutilities";
import { DiagnosticStyle } from "../../src/configuration";
import { expect } from "chai";

const isEqual = (d1: vscode.Diagnostic, d2: vscode.Diagnostic) => {
    return (
        d1.severity === d2.severity &&
        d1.source === d2.source &&
        d1.message === d2.message &&
        d1.range.isEqual(d2.range)
    );
};

const findDiagnostic = (expected: vscode.Diagnostic) => (d: vscode.Diagnostic) =>
    isEqual(d, expected);

function assertHasDiagnostic(uri: vscode.Uri, expected: vscode.Diagnostic): vscode.Diagnostic {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const diagnostic = diagnostics.find(findDiagnostic(expected));
    assert.notEqual(
        diagnostic,
        undefined,
        `Could not find diagnostic matching:\n${JSON.stringify(expected)}\nDiagnostics found:\n${JSON.stringify(diagnostics)}`
    );
    return diagnostic!;
}

function assertWithoutDiagnostic(uri: vscode.Uri, expected: vscode.Diagnostic) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    assert.equal(
        diagnostics.find(findDiagnostic(expected)),
        undefined,
        `Unexpected diagnostic matching:\n${JSON.stringify(expected)}\nDiagnostics:\n${JSON.stringify(diagnostics)}`
    );
}

suite("DiagnosticsManager Test Suite", function () {
    // Was hitting a timeout in suiteSetup during CI build once in a while
    this.timeout(15000);

    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let cFolderContext: FolderContext;
    let cppFolderContext: FolderContext;
    let toolchain: SwiftToolchain;

    let mainUri: vscode.Uri;
    let funcUri: vscode.Uri;
    let cUri: vscode.Uri;
    let cppUri: vscode.Uri;
    let cppHeaderUri: vscode.Uri;
    let diagnosticWaiterDisposable: vscode.Disposable | undefined;
    let remainingExpectedDiagnostics:
        | {
              [uri: string]: vscode.Diagnostic[];
          }
        | undefined;

    // Wait for all the expected diagnostics to be recieved. This may happen over several `onChangeDiagnostics` events.
    type ExpectedDiagnostics = { [uri: string]: vscode.Diagnostic[] };
    const waitForDiagnostics = (expectedDiagnostics: ExpectedDiagnostics) => {
        return new Promise<void>(resolve => {
            if (diagnosticWaiterDisposable) {
                console.warn(
                    "Wait for diagnostics was called before the previous wait was resolved. Only one waitForDiagnostics should run per test."
                );
                diagnosticWaiterDisposable?.dispose();
            }
            // Keep a lookup of diagnostics we haven't encountered yet. When all array values in
            // this lookup are empty then we've seen all diagnostics and we can resolve successfully.
            const expected = { ...expectedDiagnostics };
            diagnosticWaiterDisposable = vscode.languages.onDidChangeDiagnostics(e => {
                const matchingPaths = Object.keys(expectedDiagnostics).filter(uri =>
                    e.uris.some(u => u.fsPath === uri)
                );
                for (const uri of matchingPaths) {
                    const actualDiagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(uri));
                    expected[uri] = expected[uri].filter(expectedDiagnostic => {
                        return !actualDiagnostics.some(actualDiagnostic =>
                            isEqual(actualDiagnostic, expectedDiagnostic)
                        );
                    });
                    remainingExpectedDiagnostics = expected;
                }

                const allDiagnosticsFulfilled = Object.values(expected).every(
                    diagnostics => diagnostics.length === 0
                );

                if (allDiagnosticsFulfilled) {
                    diagnosticWaiterDisposable?.dispose();
                    diagnosticWaiterDisposable = undefined;
                    resolve();
                }
            });
        });
    };

    activateExtensionForSuite({
        async setup(ctx) {
            this.timeout(60000 * 5);

            workspaceContext = ctx;
            toolchain = workspaceContext.globalToolchain;
            folderContext = await folderInRootWorkspace("diagnostics", workspaceContext);
            cFolderContext = await folderInRootWorkspace("diagnosticsC", workspaceContext);
            cppFolderContext = await folderInRootWorkspace("diagnosticsCpp", workspaceContext);
            mainUri = testAssetUri("diagnostics/Sources/main.swift");
            funcUri = testAssetUri("diagnostics/Sources/func.swift");
            cUri = testAssetUri("diagnosticsC/Sources/MyPoint/MyPoint.c");
            cppUri = testAssetUri("diagnosticsCpp/Sources/MyPoint/MyPoint.cpp");
            cppHeaderUri = testAssetUri("diagnosticsCpp/Sources/MyPoint/include/MyPoint.h");
        },
    });

    teardown(function () {
        diagnosticWaiterDisposable?.dispose();
        diagnosticWaiterDisposable = undefined;
        const allDiagnosticsFulfilled = Object.values(remainingExpectedDiagnostics ?? {}).every(
            diagnostics => diagnostics.length === 0
        );
        if (!allDiagnosticsFulfilled) {
            const title = this.currentTest?.fullTitle() ?? "<unknown test>";
            const remainingDiagnostics = Object.entries(remainingExpectedDiagnostics ?? {}).filter(
                ([_uri, diagnostics]) => diagnostics.length > 0
            );
            console.error(
                `${title} - Not all diagnostics were fulfilled. Remaining:`,
                JSON.stringify(remainingDiagnostics, undefined, " ")
            );
        }
    });

    suite("Parse diagnostics", function () {
        this.timeout(60000 * 2);

        suite("Parse from task output", () => {
            const expectedWarningDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 8)),
                "Initialization of variable 'unused' was never used; consider replacing with assignment to '_' or removing it",
                vscode.DiagnosticSeverity.Warning
            );
            expectedWarningDiagnostic.source = "swiftc";

            const expectedMainErrorDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(7, 0), new vscode.Position(7, 0)),
                "Cannot assign to value: 'bar' is a 'let' constant",
                vscode.DiagnosticSeverity.Error
            );
            expectedMainErrorDiagnostic.source = "swiftc";

            const expectedMainDictErrorDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(15, 35), new vscode.Position(15, 35)),
                "Use [:] to get an empty dictionary literal",
                vscode.DiagnosticSeverity.Error
            );
            expectedMainDictErrorDiagnostic.source = "swiftc";

            const expectedFuncErrorDiagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 4), new vscode.Position(1, 4)),
                "Cannot find 'baz' in scope",
                vscode.DiagnosticSeverity.Error
            );
            expectedFuncErrorDiagnostic.source = "swiftc";

            const expectedMacroDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(19, 26), new vscode.Position(19, 26)),
                "No calls to throwing functions occur within 'try' expression",
                vscode.DiagnosticSeverity.Warning
            );

            expectedMacroDiagnostic.source = "swiftc";
            expectedMacroDiagnostic.relatedInformation = [
                {
                    location: {
                        uri: mainUri,
                        range: expectedMacroDiagnostic.range,
                    },
                    message: "Expanded code originates here",
                },
            ];

            function runTestDiagnosticStyle(
                style: DiagnosticStyle,
                expected: () => ExpectedDiagnostics,
                callback?: () => void
            ) {
                suite(`${style} diagnosticsStyle`, async function () {
                    let resetSettings: (() => Promise<void>) | undefined;
                    suiteTeardown(async () => {
                        if (resetSettings) {
                            await resetSettings();
                            resetSettings = undefined;
                        }
                    });

                    // SourceKit-LSP sometimes sends diagnostics
                    // after first build and can cause intermittent
                    // failure if `swiftc` diagnostic is fixed
                    suiteSetup(async function () {
                        // Swift 5.10 and 6.0 on Windows have a bug where the
                        // diagnostics are not emitted on their own line.
                        const swiftVersion = workspaceContext.globalToolchain.swiftVersion;
                        if (
                            swiftVersion.isLessThan(new Version(5, 10, 0)) ||
                            (process.platform === "win32" &&
                                swiftVersion.isGreaterThanOrEqual(new Version(5, 10, 0)) &&
                                swiftVersion.isLessThanOrEqual(new Version(6, 0, 999)))
                        ) {
                            this.skip();
                        }
                        this.timeout(5 * 60 * 1000); // Allow 5 minutes to build

                        // Clean up any lingering diagnostics
                        workspaceContext.diagnostics.clear();
                        await workspaceContext.focusFolder(null);

                        resetSettings = await updateSettings({ "swift.diagnosticsStyle": style });
                    });

                    test("succeeds", async function () {
                        await Promise.all([
                            waitForDiagnostics(expected()),
                            createBuildAllTask(folderContext).then(task =>
                                executeTaskAndWaitForResult(task).catch(() => {
                                    /* Ignore */
                                })
                            ),
                        ]);
                        await waitForNoRunningTasks();
                    });

                    callback && callback();
                });
            }

            runTestDiagnosticStyle("default", () => ({
                [mainUri.fsPath]: [
                    expectedWarningDiagnostic,
                    expectedMainErrorDiagnostic,
                    expectedMainDictErrorDiagnostic,
                    ...(workspaceContext.globalToolchainSwiftVersion.isGreaterThanOrEqual(
                        new Version(6, 0, 0)
                    )
                        ? [expectedMacroDiagnostic]
                        : []),
                ], // Should have parsed correct severity
                [funcUri.fsPath]: [expectedFuncErrorDiagnostic], // Check parsed for other file
            }));

            runTestDiagnosticStyle("swift", () => ({
                [mainUri.fsPath]: [
                    expectedWarningDiagnostic,
                    expectedMainErrorDiagnostic,
                    expectedMainDictErrorDiagnostic,
                ], // Should have parsed correct severity
                [funcUri.fsPath]: [expectedFuncErrorDiagnostic], // Check parsed for other file
            }));

            runTestDiagnosticStyle(
                "llvm",
                () => ({
                    [mainUri.fsPath]: [
                        expectedWarningDiagnostic,
                        expectedMainErrorDiagnostic,
                        expectedMainDictErrorDiagnostic,
                    ], // Should have parsed correct severity
                    [funcUri.fsPath]: [expectedFuncErrorDiagnostic], // Check parsed for other file
                }),
                () => {
                    test("Parses related information", async () => {
                        const diagnostic = assertHasDiagnostic(
                            mainUri,
                            expectedMainErrorDiagnostic
                        );
                        // Should have parsed related note
                        assert.equal(diagnostic.relatedInformation?.length, 1);
                        assert.equal(
                            diagnostic.relatedInformation![0].message,
                            "Change 'let' to 'var' to make it mutable"
                        );
                        assert.equal(
                            diagnostic.relatedInformation![0].location.uri.fsPath,
                            mainUri.fsPath
                        );
                        assert.equal(
                            diagnostic.relatedInformation![0].location.range.isEqual(
                                new vscode.Range(
                                    new vscode.Position(6, 0),
                                    new vscode.Position(6, 0)
                                )
                            ),
                            true
                        );
                    });

                    test("Parses C diagnostics", async function () {
                        // Should have parsed severity
                        const expectedDiagnostic1 = new vscode.Diagnostic(
                            new vscode.Range(
                                new vscode.Position(5, 10),
                                new vscode.Position(5, 10)
                            ),
                            "Use of undeclared identifier 'bar'",
                            vscode.DiagnosticSeverity.Error
                        );
                        expectedDiagnostic1.source = "swiftc";
                        const expectedDiagnostic2 = new vscode.Diagnostic(
                            new vscode.Range(new vscode.Position(6, 6), new vscode.Position(6, 6)),
                            "No member named 'z' in 'struct MyPoint'",
                            vscode.DiagnosticSeverity.Error
                        );
                        expectedDiagnostic2.source = "swiftc";

                        await Promise.all([
                            waitForDiagnostics({
                                [cUri.fsPath]: [expectedDiagnostic1, expectedDiagnostic2],
                            }),
                            createBuildAllTask(cFolderContext).then(task =>
                                executeTaskAndWaitForResult(task)
                            ),
                        ]);
                        await waitForNoRunningTasks();
                    });

                    test("Parses C++ diagnostics", async function () {
                        // Should have parsed severity
                        const expectedDiagnostic1 = new vscode.Diagnostic(
                            new vscode.Range(new vscode.Position(6, 5), new vscode.Position(6, 5)),
                            "Member reference type 'MyPoint *' is a pointer; did you mean to use '->'?",
                            vscode.DiagnosticSeverity.Error
                        );
                        expectedDiagnostic1.source = "swiftc";

                        // Should have parsed releated information
                        const expectedDiagnostic2 = new vscode.Diagnostic(
                            new vscode.Range(
                                new vscode.Position(3, 21),
                                new vscode.Position(3, 21)
                            ),
                            "Unknown type name 'MyPoint2'; did you mean 'MyPoint'?",
                            vscode.DiagnosticSeverity.Error
                        );
                        expectedDiagnostic2.source = "swiftc";

                        // Message should not contain [-Wreturn-mismatch] so it can be merged with
                        // SourceKit diagnostics if required
                        const expectedDiagnostic3 = new vscode.Diagnostic(
                            new vscode.Range(
                                new vscode.Position(11, 4),
                                new vscode.Position(11, 4)
                            ),
                            "Non-void function 'main' should return a value",
                            vscode.DiagnosticSeverity.Error
                        );
                        expectedDiagnostic3.source = "swiftc";

                        await Promise.all([
                            waitForDiagnostics({
                                [cppUri.fsPath]: [
                                    expectedDiagnostic1,
                                    expectedDiagnostic2,
                                    expectedDiagnostic3,
                                ],
                            }),
                            createBuildAllTask(cppFolderContext).then(task =>
                                executeTaskAndWaitForResult(task)
                            ),
                        ]);
                        await waitForNoRunningTasks();

                        const diagnostic = assertHasDiagnostic(cppUri, expectedDiagnostic2);
                        assert.equal(
                            diagnostic.relatedInformation![0].location.uri.fsPath,
                            cppHeaderUri.fsPath
                        );
                        assert.equal(
                            diagnostic.relatedInformation![0].location.range.isEqual(
                                new vscode.Range(
                                    new vscode.Position(0, 6),
                                    new vscode.Position(0, 6)
                                )
                            ),
                            true
                        );
                    });
                }
            );
        });

        suite("Controlled output", () => {
            const outputDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(12, 4), new vscode.Position(12, 4)),
                "Cannot find 'foo' in scope",
                vscode.DiagnosticSeverity.Error
            );
            outputDiagnostic.source = "swiftc";
            let workspaceFolder: vscode.WorkspaceFolder;

            setup(async () => {
                await waitForNoRunningTasks();
                workspaceContext.diagnostics.clear();
                workspaceFolder = folderContext.workspaceFolder;
            });

            test("Parse partial line", async () => {
                const fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
                await vscode.tasks.executeTask(fixture.task);
                // Wait to spawn before writing
                fixture.process.write(`${mainUri.fsPath}:13:5: err`, "");
                fixture.process.write("or: Cannot find 'fo", "");
                fixture.process.write("o' in scope");
                fixture.process.close(1);
                await waitForNoRunningTasks();
                // Should have parsed
                assertHasDiagnostic(mainUri, outputDiagnostic);
            });

            // https://github.com/apple/swift/issues/73973
            test("Ignore duplicates", async () => {
                const fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
                await vscode.tasks.executeTask(fixture.task);
                // Wait to spawn before writing
                const output = `${mainUri.fsPath}:13:5: error: Cannot find 'foo' in scope`;
                fixture.process.write(output);
                fixture.process.write("some random output");
                fixture.process.write(output);
                fixture.process.close(1);
                await waitForNoRunningTasks();
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                // Should only include one
                assert.equal(diagnostics.length, 1);
                assertHasDiagnostic(mainUri, outputDiagnostic);
            });

            test("New set of swiftc diagnostics clear old list", async () => {
                let fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
                await vscode.tasks.executeTask(fixture.task);
                // Wait to spawn before writing
                fixture.process.write(`${mainUri.fsPath}:13:5: error: Cannot find 'foo' in scope`);
                fixture.process.close(1);
                await waitForNoRunningTasks();
                let diagnostics = vscode.languages.getDiagnostics(mainUri);
                // Should only include one
                assert.equal(diagnostics.length, 1);
                assertHasDiagnostic(mainUri, outputDiagnostic);

                // Run again but no diagnostics returned
                fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
                await vscode.tasks.executeTask(fixture.task);
                fixture.process.close(0);
                await waitForNoRunningTasks();
                diagnostics = vscode.languages.getDiagnostics(mainUri);
                // Should have cleaned up
                assert.equal(diagnostics.length, 0);
            });

            // https://github.com/apple/swift/issues/73973
            test("Ignore XCTest failures", async () => {
                const testUri = testAssetUri("diagnostics/Tests/MyCLITests/MyCLIXCTests.swift");
                const fixture = testSwiftTask("swift", ["test"], workspaceFolder, toolchain);
                await vscode.tasks.executeTask(fixture.task);
                // Wait to spawn before writing
                fixture.process.write("Build complete!");
                fixture.process.write(
                    `${testUri.path}:11: error: -[MyCLITests.MyCLIXCTests testFailure] : XCTAssertEqual failed: ("41") is not equal to ("42")`
                );
                fixture.process.close(1);
                await waitForNoRunningTasks();
                const diagnostics = vscode.languages.getDiagnostics(testUri);
                // Should be empty
                assert.equal(diagnostics.length, 0);
            });
        });
    });

    suite("Merge diagnostics", () => {
        let swiftcErrorDiagnostic: vscode.Diagnostic;
        let swiftcWarningDiagnostic: vscode.Diagnostic;
        let swiftcLowercaseDiagnostic: vscode.Diagnostic;
        let sourcekitErrorDiagnostic: vscode.Diagnostic;
        let sourcekitWarningDiagnostic: vscode.Diagnostic;
        let sourcekitLowercaseDiagnostic: vscode.Diagnostic;
        let clangErrorDiagnostic: vscode.Diagnostic;
        let swiftcClangErrorDiagnostic: vscode.Diagnostic;

        setup(async () => {
            workspaceContext.diagnostics.clear();
            swiftcErrorDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 8)), // Note swiftc provides empty range
                "Cannot assign to value: 'bar' is a 'let' constant",
                vscode.DiagnosticSeverity.Error
            );
            swiftcErrorDiagnostic.source = "swiftc";
            swiftcLowercaseDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 8)), // Note swiftc provides empty range
                "cannot assign to value: 'bar' is a 'let' constant",
                vscode.DiagnosticSeverity.Error
            );
            swiftcLowercaseDiagnostic.source = "swiftc";
            swiftcWarningDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(2, 4), new vscode.Position(2, 4)), // Note swiftc provides empty range
                "Initialization of variable 'unused' was never used; consider replacing with assignment to '_' or removing it",
                vscode.DiagnosticSeverity.Warning
            );
            swiftcWarningDiagnostic.source = "swiftc";
            sourcekitErrorDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 14)), // Note SourceKit provides full range
                "Cannot assign to value: 'bar' is a 'let' constant",
                vscode.DiagnosticSeverity.Error
            );
            sourcekitErrorDiagnostic.source = "SourceKit";
            sourcekitLowercaseDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 14)), // Note SourceKit provides full range
                "cannot assign to value: 'bar' is a 'let' constant",
                vscode.DiagnosticSeverity.Error
            );
            sourcekitLowercaseDiagnostic.source = "SourceKit";
            sourcekitWarningDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(2, 4), new vscode.Position(2, 10)), // Note SourceKit provides full range
                "Initialization of variable 'unused' was never used; consider replacing with assignment to '_' or removing it",
                vscode.DiagnosticSeverity.Warning
            );
            sourcekitWarningDiagnostic.source = "SourceKit";

            clangErrorDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(5, 10), new vscode.Position(5, 13)),
                "Use of undeclared identifier 'bar'",
                vscode.DiagnosticSeverity.Error
            );
            clangErrorDiagnostic.source = "clang"; // Set by LSP
            swiftcClangErrorDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(5, 10), new vscode.Position(5, 13)),
                "Use of undeclared identifier 'bar'",
                vscode.DiagnosticSeverity.Error
            );
            swiftcClangErrorDiagnostic.source = "swiftc";
        });

        suite("markdownLinks", () => {
            let diagnostic: vscode.Diagnostic;

            setup(async () => {
                workspaceContext.diagnostics.clear();
                diagnostic = new vscode.Diagnostic(
                    new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 8)), // Note swiftc provides empty range
                    "Cannot assign to value: 'bar' is a 'let' constant",
                    vscode.DiagnosticSeverity.Error
                );
                diagnostic.source = "SourceKit";
            });

            test("ignore strings", async () => {
                diagnostic.code = "string";

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [diagnostic]
                );

                // check diagnostic hasn't changed
                assertHasDiagnostic(mainUri, diagnostic);

                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                const matchingDiagnostic = diagnostics.find(findDiagnostic(diagnostic));

                expect(matchingDiagnostic).to.have.property("code", "string");
            });

            test("ignore numbers", async () => {
                diagnostic.code = 1;

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [diagnostic]
                );

                // check diagnostic hasn't changed
                assertHasDiagnostic(mainUri, diagnostic);

                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                const matchingDiagnostic = diagnostics.find(findDiagnostic(diagnostic));

                expect(matchingDiagnostic).to.have.property("code", 1);
            });

            test("target without markdown link", async () => {
                const diagnosticCode = {
                    value: "string",
                    target: vscode.Uri.file("/some/path/md/readme.txt"),
                };
                diagnostic.code = diagnosticCode;

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [diagnostic]
                );

                // check diagnostic hasn't changed
                assertHasDiagnostic(mainUri, diagnostic);

                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                const matchingDiagnostic = diagnostics.find(findDiagnostic(diagnostic));

                expect(matchingDiagnostic).to.have.property("code", diagnostic.code);
            });

            test("target with markdown link", async () => {
                const pathToMd = "/some/path/md/readme.md";
                diagnostic.code = {
                    value: "string",
                    target: vscode.Uri.file(pathToMd),
                };

                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [diagnostic]
                );

                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                const matchingDiagnostic = diagnostics.find(findDiagnostic(diagnostic));

                expect(matchingDiagnostic).to.have.property("code");
                expect(matchingDiagnostic?.code).to.have.property("value", "More Information...");

                if (
                    matchingDiagnostic &&
                    matchingDiagnostic.code &&
                    typeof matchingDiagnostic.code !== "string" &&
                    typeof matchingDiagnostic.code !== "number"
                ) {
                    expect(matchingDiagnostic.code.target.scheme).to.equal("command");
                    expect(matchingDiagnostic.code.target.path).to.equal(
                        "swift.openEducationalNote"
                    );
                    expect(matchingDiagnostic.code.target.query).to.contain(pathToMd);
                } else {
                    assert.fail("Diagnostic target not replaced with markdown command");
                }
            });
        });

        suite("keepAll", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            suiteTeardown(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            suiteSetup(async function () {
                resetSettings = await updateSettings({
                    "swift.diagnosticsCollection": "keepAll",
                });
            });

            test("merge in SourceKit diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // check kept all
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("merge in clangd diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(cUri, DiagnosticsManager.isSwiftc, [
                    swiftcClangErrorDiagnostic,
                ]);

                // Now provide identical clangd diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    cUri,
                    DiagnosticsManager.isSourcekit,
                    [clangErrorDiagnostic]
                );

                // check clangd merged in
                assertHasDiagnostic(cUri, clangErrorDiagnostic);
                // check swiftc merged in
                assertHasDiagnostic(cUri, swiftcClangErrorDiagnostic);
            });

            test("merge in swiftc diagnostics", async () => {
                // Add initial SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic]
                );

                // check kept all
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });
        });

        suite("keepSourceKit", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            suiteTeardown(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            suiteSetup(async function () {
                resetSettings = await updateSettings({
                    "swift.diagnosticsCollection": "keepSourceKit",
                });
            });

            test("merge in SourceKit diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // check SourceKit merged in
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // swiftc deduplicated
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                // kept unique swiftc diagnostic
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("merge in sourcekitd diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );

                // Now provide identical sourcekitd diagnostic
                sourcekitErrorDiagnostic.source = "sourcekitd"; // pre-Swift 6
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // check sourcekitd merged in
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // swiftc deduplicated
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                // kept unique swiftc diagnostic
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("merge in clangd diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(cUri, DiagnosticsManager.isSwiftc, [
                    swiftcClangErrorDiagnostic,
                ]);

                // Now provide identical clangd diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    cUri,
                    DiagnosticsManager.isSourcekit,
                    [clangErrorDiagnostic]
                );

                // check clangd merged in
                assertHasDiagnostic(cUri, clangErrorDiagnostic);
                // swiftc deduplicated
                assertWithoutDiagnostic(cUri, swiftcClangErrorDiagnostic);
            });

            test("merge in swiftc diagnostics", async () => {
                // Add initial SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );

                // check SourceKit stayed in collection
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // swiftc ignored
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                // kept unique swiftc diagnostic
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("no SourceKit diagnostics", async () => {
                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );

                // check added all diagnostics into collection
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("discrepency in capitalization", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );

                // Now provide SourceKit diagnostic with different capitalization
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitLowercaseDiagnostic]
                );

                // check SourceKit merged in capitalized one
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // swiftc deduplicated
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                // kept unique swiftc diagnostic
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });
        });

        suite("keepSwiftc", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            suiteTeardown(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            suiteSetup(async function () {
                resetSettings = await updateSettings({
                    "swift.diagnosticsCollection": "keepSwiftc",
                });
            });

            test("merge in swiftc diagnostics", async () => {
                // Add initial SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic]
                );

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // SourceKit deduplicated
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // kept unique SourceKit diagnostic
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("merge in clangd diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(cUri, DiagnosticsManager.isSwiftc, [
                    swiftcClangErrorDiagnostic,
                ]);

                // Now provide identical clangd diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    cUri,
                    DiagnosticsManager.isSourcekit,
                    [clangErrorDiagnostic]
                );

                // check swiftc stayed in
                assertHasDiagnostic(cUri, swiftcClangErrorDiagnostic);
                // clangd ignored
                assertWithoutDiagnostic(cUri, clangErrorDiagnostic);
            });

            test("merge in SourceKit diagnostics", async () => {
                // Add initial swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic]
                );

                // Now provide SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // check swiftc stayed in collection
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // swiftc ignored
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // kept unique SourceKit diagnostic
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("no swiftc diagnostics", async () => {
                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // check added all diagnostics into collection
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("discrepency in capitalization", async () => {
                // Add initial SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide swiftc diagnostic with different capitalization
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcLowercaseDiagnostic]
                );

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // SourceKit deduplicated
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // kept unique SourceKit diagnostic
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });
        });

        suite("onlySourceKit", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            suiteTeardown(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            suiteSetup(async function () {
                resetSettings = await updateSettings({
                    "swift.diagnosticsCollection": "onlySourceKit",
                });
            });

            test("merge in SourceKit diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcErrorDiagnostic]
                );

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // check SourceKit merged in
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // ignored swiftc
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("merge in clangd diagnostics", async () => {
                // Provide clangd diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    cUri,
                    DiagnosticsManager.isSourcekit,
                    [clangErrorDiagnostic]
                );

                // Add identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(cUri, DiagnosticsManager.isSwiftc, [
                    swiftcClangErrorDiagnostic,
                ]);

                // check clangd merged in
                assertHasDiagnostic(cUri, clangErrorDiagnostic);
                // swiftc ignored
                assertWithoutDiagnostic(cUri, swiftcClangErrorDiagnostic);
            });

            test("ignore swiftc diagnostics", async () => {
                // Provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );

                // ignored swiftc
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("clean old swiftc diagnostics", async () => {
                workspaceContext.diagnostics.allDiagnostics.set(mainUri.fsPath, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // Now change to onlySourceKit and provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // check SourceKit merged in
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // cleaned swiftc
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });
        });

        suite("onlySwiftc", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            suiteTeardown(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            suiteSetup(async function () {
                resetSettings = await updateSettings({
                    "swift.diagnosticsCollection": "onlySwiftc",
                });
            });

            test("merge in swiftc diagnostics", async () => {
                // Add initial SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic]
                );

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // ignored SourceKit
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("ignore SourceKit diagnostics", async () => {
                // Provide SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // ignored SourceKit
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("ignore clangd diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(cUri, DiagnosticsManager.isSwiftc, [
                    swiftcClangErrorDiagnostic,
                ]);

                // Now provide identical clangd diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    cUri,
                    DiagnosticsManager.isSourcekit,
                    [clangErrorDiagnostic]
                );

                // check swiftc stayed in
                assertHasDiagnostic(cUri, swiftcClangErrorDiagnostic);
                // clangd ignored
                assertWithoutDiagnostic(cUri, clangErrorDiagnostic);
            });

            test("clean old SourceKit diagnostics", async () => {
                // Add initial SourceKit diagnostics
                workspaceContext.diagnostics.allDiagnostics.set(mainUri.fsPath, [
                    sourcekitErrorDiagnostic,
                    sourcekitWarningDiagnostic,
                ]);

                // Now change to onlySwiftc and provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic]
                );

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // cleaned SourceKit
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });
        });

        suite("cleanup", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            suiteTeardown(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            suiteSetup(async function () {
                resetSettings = await updateSettings({
                    "swift.diagnosticsCollection": undefined,
                });
            });

            test("SourceKit removes swiftc diagnostic (SourceKit shows first)", async () => {
                // Add initial diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic]
                );

                // Have SourceKit indicate some have been fixed
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitWarningDiagnostic]
                );

                // check cleaned up stale error
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("SourceKit removes swiftc diagnostic (swiftc shows first)", async () => {
                // Add initial diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // Have SourceKit indicate has been fixed
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    []
                );

                // check cleaned up stale error
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("clangd removes swiftc diagnostic (swiftc shows first)", async () => {
                // Add initial diagnostics
                workspaceContext.diagnostics.handleDiagnostics(cUri, DiagnosticsManager.isSwiftc, [
                    swiftcClangErrorDiagnostic,
                ]);
                workspaceContext.diagnostics.handleDiagnostics(
                    cUri,
                    DiagnosticsManager.isSourcekit,
                    [clangErrorDiagnostic]
                );

                // Have clangd indicate has been fixed
                workspaceContext.diagnostics.handleDiagnostics(
                    cUri,
                    DiagnosticsManager.isSourcekit,
                    []
                );

                // check cleaned up stale error
                assertWithoutDiagnostic(cUri, clangErrorDiagnostic);
                assertWithoutDiagnostic(cUri, swiftcClangErrorDiagnostic);
            });

            test("don't remove swiftc diagnostics when SourceKit never matched", async () => {
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic]
                );

                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitWarningDiagnostic]
                );

                // Should not have cleaned up swiftc error
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });
        });
    });
});
