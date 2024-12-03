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
import { executeTaskAndWaitForResult, waitForNoRunningTasks } from "../utilities";
import { WorkspaceContext } from "../../src/WorkspaceContext";
import { testAssetWorkspaceFolder, testSwiftTask } from "../fixtures";
import { createBuildAllTask } from "../../src/tasks/SwiftTaskProvider";
import { DiagnosticsManager } from "../../src/DiagnosticsManager";
import { FolderContext } from "../../src/FolderContext";
import { Version } from "../../src/utilities/version";
import { Workbench } from "../../src/utilities/commands";
import { activateExtensionForSuite, folderInRootWorkspace } from "./utilities/testutilities";

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

suite("DiagnosticsManager Test Suite", async function () {
    // Was hitting a timeout in suiteSetup during CI build once in a while
    this.timeout(5000);

    const swiftConfig = vscode.workspace.getConfiguration("swift");

    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let cFolderContext: FolderContext;
    let cppFolderContext: FolderContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;
    let cWorkspaceFolder: vscode.WorkspaceFolder;
    let cppWorkspaceFolder: vscode.WorkspaceFolder;

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
    const waitForDiagnostics = (expectedDiagnostics: { [uri: string]: vscode.Diagnostic[] }) => {
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
            this.timeout(60000 * 2);

            workspaceContext = ctx;
            toolchain = workspaceContext.toolchain;
            workspaceFolder = testAssetWorkspaceFolder("diagnostics");
            cWorkspaceFolder = testAssetWorkspaceFolder("diagnosticsC");
            cppWorkspaceFolder = testAssetWorkspaceFolder("diagnosticsCpp");
            folderContext = await folderInRootWorkspace("diagnostics", workspaceContext);
            cFolderContext = await folderInRootWorkspace("diagnosticsC", workspaceContext);
            cppFolderContext = await folderInRootWorkspace("diagnosticsCpp", workspaceContext);
            mainUri = vscode.Uri.file(`${workspaceFolder.uri.path}/Sources/main.swift`);
            funcUri = vscode.Uri.file(`${workspaceFolder.uri.path}/Sources/func.swift`);
            cUri = vscode.Uri.file(`${cWorkspaceFolder.uri.path}/Sources/MyPoint/MyPoint.c`);
            cppUri = vscode.Uri.file(`${cppWorkspaceFolder.uri.path}/Sources/MyPoint/MyPoint.cpp`);
            cppHeaderUri = vscode.Uri.file(
                `${cppWorkspaceFolder.uri.path}/Sources/MyPoint/include/MyPoint.h`
            );
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
                `${title} - Not all diagnostics were fulfilled`,
                JSON.stringify(remainingDiagnostics, undefined, " ")
            );
        }
    });

    suite("Parse diagnostics", async function () {
        this.timeout(60000 * 2);

        suite("Parse from task output", async () => {
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

            const expectedFuncErrorDiagnostic: vscode.Diagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 4), new vscode.Position(1, 4)),
                "Cannot find 'baz' in scope",
                vscode.DiagnosticSeverity.Error
            );
            expectedFuncErrorDiagnostic.source = "swiftc";

            const expectedMacroDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(17, 26), new vscode.Position(17, 26)),
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

            // SourceKit-LSP sometimes sends diagnostics
            // after first build and can cause intermittent
            // failure if `swiftc` diagnostic is fixed
            suiteSetup(async function () {
                this.timeout(2 * 60 * 1000); // Allow 2 minutes to build
                const task = createBuildAllTask(folderContext);
                // This return exit code and output for the task but we will omit it here
                // because the failures are expected and we just want the task to build
                await executeTaskAndWaitForResult(task);
            });

            suiteTeardown(async () => {
                await swiftConfig.update("diagnosticsStyle", undefined);
            });

            test("default diagnosticsStyle", async function () {
                // Swift 5.10 and 6.0 on Windows have a bug where the
                // diagnostics are not emitted on their own line.
                const swiftVersion = workspaceContext.toolchain.swiftVersion;
                if (
                    process.platform === "win32" &&
                    swiftVersion.isGreaterThanOrEqual(new Version(5, 10, 0)) &&
                    swiftVersion.isLessThanOrEqual(new Version(6, 0, 999))
                ) {
                    this.skip();
                }
                await swiftConfig.update("diagnosticsStyle", "default");

                await Promise.all([
                    waitForDiagnostics({
                        [mainUri.fsPath]: [
                            expectedWarningDiagnostic,
                            expectedMainErrorDiagnostic,
                            ...(workspaceContext.swiftVersion.isGreaterThanOrEqual(
                                new Version(6, 0, 0)
                            )
                                ? [expectedMacroDiagnostic]
                                : []),
                        ], // Should have parsed correct severity
                        [funcUri.fsPath]: [expectedFuncErrorDiagnostic], // Check parsed for other file
                    }),
                    executeTaskAndWaitForResult(createBuildAllTask(folderContext)),
                ]);

                await waitForNoRunningTasks();
            });

            test("swift diagnosticsStyle", async function () {
                // This is only supported in swift versions >=5.10.0.
                // Swift 5.10 and 6.0 on Windows have a bug where the
                // diagnostics are not emitted on their own line.
                const swiftVersion = workspaceContext.toolchain.swiftVersion;
                if (
                    swiftVersion.isLessThan(new Version(5, 10, 0)) ||
                    (process.platform === "win32" &&
                        swiftVersion.isGreaterThanOrEqual(new Version(5, 10, 0)) &&
                        swiftVersion.isLessThanOrEqual(new Version(6, 0, 999)))
                ) {
                    this.skip();
                }
                await swiftConfig.update("diagnosticsStyle", "swift");

                await Promise.all([
                    waitForDiagnostics({
                        [mainUri.fsPath]: [expectedWarningDiagnostic, expectedMainErrorDiagnostic], // Should have parsed correct severity
                        [funcUri.fsPath]: [expectedFuncErrorDiagnostic], // Check parsed for other file
                    }),
                    executeTaskAndWaitForResult(createBuildAllTask(folderContext)),
                ]);
                await waitForNoRunningTasks();
            });

            test("llvm diagnosticsStyle", async () => {
                await swiftConfig.update("diagnosticsStyle", "llvm");

                await Promise.all([
                    waitForDiagnostics({
                        [mainUri.fsPath]: [expectedWarningDiagnostic, expectedMainErrorDiagnostic], // Should have parsed correct severity
                        [funcUri.fsPath]: [expectedFuncErrorDiagnostic], // Check parsed for other file
                    }),
                    executeTaskAndWaitForResult(createBuildAllTask(folderContext)),
                ]);
                await waitForNoRunningTasks();

                // Should have parsed severity
                const diagnostic = assertHasDiagnostic(mainUri, expectedMainErrorDiagnostic);
                // Should have parsed related note
                assert.equal(diagnostic.relatedInformation?.length, 1);
                assert.equal(
                    diagnostic.relatedInformation![0].message,
                    "Change 'let' to 'var' to make it mutable"
                );
                assert.equal(diagnostic.relatedInformation![0].location.uri.fsPath, mainUri.fsPath);
                assert.equal(
                    diagnostic.relatedInformation![0].location.range.isEqual(
                        new vscode.Range(new vscode.Position(6, 0), new vscode.Position(6, 0))
                    ),
                    true
                );
            });

            test("Parses C diagnostics", async function () {
                const swiftVersion = workspaceContext.toolchain.swiftVersion;
                // SPM will sometimes improperly clear diagnostics from the terminal, leading
                // to a flakey test.
                if (swiftVersion.isLessThan(new Version(5, 7, 0))) {
                    this.skip();
                }

                await swiftConfig.update("diagnosticsStyle", "llvm");

                // Should have parsed severity
                const expectedDiagnostic1 = new vscode.Diagnostic(
                    new vscode.Range(new vscode.Position(5, 10), new vscode.Position(5, 10)),
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
                    executeTaskAndWaitForResult(createBuildAllTask(cFolderContext)),
                ]);
                await waitForNoRunningTasks();
            });

            test("Parses C++ diagnostics", async function () {
                const swiftVersion = workspaceContext.toolchain.swiftVersion;
                // SPM will sometimes improperly clear diagnostics from the terminal, leading
                // to a flakey test.
                if (swiftVersion.isLessThan(new Version(5, 7, 0))) {
                    this.skip();
                }

                await swiftConfig.update("diagnosticsStyle", "llvm");

                // Should have parsed severity
                const expectedDiagnostic1 = new vscode.Diagnostic(
                    new vscode.Range(new vscode.Position(6, 5), new vscode.Position(6, 5)),
                    "Member reference type 'MyPoint *' is a pointer; did you mean to use '->'?",
                    vscode.DiagnosticSeverity.Error
                );
                expectedDiagnostic1.source = "swiftc";

                // Should have parsed releated information
                const expectedDiagnostic2 = new vscode.Diagnostic(
                    new vscode.Range(new vscode.Position(3, 21), new vscode.Position(3, 21)),
                    "Unknown type name 'MyPoint2'; did you mean 'MyPoint'?",
                    vscode.DiagnosticSeverity.Error
                );
                expectedDiagnostic2.source = "swiftc";

                await Promise.all([
                    waitForDiagnostics({
                        [cppUri.fsPath]: [expectedDiagnostic1, expectedDiagnostic2],
                    }),
                    executeTaskAndWaitForResult(createBuildAllTask(cppFolderContext)),
                ]);
                await waitForNoRunningTasks();

                const diagnostic = assertHasDiagnostic(cppUri, expectedDiagnostic2);
                assert.equal(
                    diagnostic.relatedInformation![0].location.uri.fsPath,
                    cppHeaderUri.fsPath
                );
                assert.equal(
                    diagnostic.relatedInformation![0].location.range.isEqual(
                        new vscode.Range(new vscode.Position(0, 6), new vscode.Position(0, 6))
                    ),
                    true
                );
            });
        });

        suite("Controlled output", () => {
            const outputDiagnostic = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(12, 4), new vscode.Position(12, 4)),
                "Cannot find 'foo' in scope",
                vscode.DiagnosticSeverity.Error
            );
            outputDiagnostic.source = "swiftc";

            setup(async () => {
                await waitForNoRunningTasks();
                workspaceContext.diagnostics.clear();
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
                const testUri = vscode.Uri.file(
                    `${workspaceFolder.uri.path}/Tests/MyCLITests/MyCLIXCTests.swift`
                );
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
        });

        suiteTeardown(async () => {
            // So test asset settings.json doesn't changedq
            await swiftConfig.update("diagnosticsCollection", undefined);
        });

        suite("keepAll", () => {
            setup(async () => {
                await swiftConfig.update("diagnosticsCollection", "keepAll");
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
            setup(async () => {
                await swiftConfig.update("diagnosticsCollection", "keepSourceKit");
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
            setup(async () => {
                await swiftConfig.update("diagnosticsCollection", "keepSwiftc");
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
            setup(async () => {
                await swiftConfig.update("diagnosticsCollection", "onlySourceKit");
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
                // Add initial swiftc diagnostics
                await swiftConfig.update("diagnosticsCollection", "keepAll");
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSwiftc,
                    [swiftcErrorDiagnostic, swiftcWarningDiagnostic]
                );
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);

                // Now change to onlySourceKit and provide identical SourceKit diagnostic
                await swiftConfig.update("diagnosticsCollection", "onlySourceKit");
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
            setup(async () => {
                await swiftConfig.update("diagnosticsCollection", "onlySwiftc");
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

            test("clean old SourceKit diagnostics", async () => {
                // Add initial SourceKit diagnostics
                await swiftConfig.update("diagnosticsCollection", "keepAll");
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.isSourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);

                // Now change to onlySwiftc and provide identical swiftc diagnostic
                await swiftConfig.update("diagnosticsCollection", "onlySwiftc");
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

        test("SourceKit removes swiftc diagnostic (SourceKit shows first)", async () => {
            // Add initial diagnostics
            workspaceContext.diagnostics.handleDiagnostics(
                mainUri,
                DiagnosticsManager.isSourcekit,
                [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
            );
            workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.isSwiftc, [
                swiftcErrorDiagnostic,
            ]);

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
            workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.isSwiftc, [
                swiftcErrorDiagnostic,
                swiftcWarningDiagnostic,
            ]);
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

        test("don't remove swiftc diagnostics when SourceKit never matched", async () => {
            workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.isSwiftc, [
                swiftcErrorDiagnostic,
            ]);

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

    // Skipped until we enable it in a nightly build
    suite("SourceKit-LSP diagnostics @slow", () => {
        suiteSetup(async function () {
            if (workspaceContext.swiftVersion.isLessThan(new Version(5, 7, 0))) {
                this.skip();
                return;
            }
            workspaceContext.diagnostics.clear();
            workspaceContext.focusFolder(null);
            await swiftConfig.update("diagnosticsCollection", "onlySourceKit"); // So waitForDiagnostics only resolves from LSP
        });

        suiteTeardown(async () => {
            await swiftConfig.update("diagnosticsCollection", undefined);
        });

        teardown(async () => {
            await vscode.commands.executeCommand(Workbench.ACTION_CLOSEALLEDITORS);
        });

        test("Provides swift diagnostics", async () => {
            // Build for indexing
            let task = createBuildAllTask(folderContext);
            await executeTaskAndWaitForResult(task);

            // Open file
            const promise = Promise.resolve(); // waitForDiagnostics([mainUri], false);
            const document = await vscode.workspace.openTextDocument(mainUri);
            await vscode.languages.setTextDocumentLanguage(document, "swift");
            await vscode.window.showTextDocument(document);

            task = createBuildAllTask(folderContext);
            await executeTaskAndWaitForResult(task);

            // Retrigger diagnostics
            await workspaceContext.focusFolder(folderContext);
            await promise;

            const lspSource = toolchain.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))
                ? "SourceKit"
                : "sourcekitd";

            // Include warning
            const expectedDiagnostic1 = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 8)),
                "Initialization of variable 'unused' was never used; consider replacing with assignment to '_' or removing it",
                vscode.DiagnosticSeverity.Warning
            );
            expectedDiagnostic1.source = lspSource; // Set by LSP
            assertHasDiagnostic(mainUri, expectedDiagnostic1);

            // Include error
            const expectedDiagnostic2 = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(7, 0), new vscode.Position(7, 3)),
                "Cannot assign to value: 'bar' is a 'let' constant",
                vscode.DiagnosticSeverity.Error
            );
            expectedDiagnostic2.source = lspSource; // Set by LSP
            assertHasDiagnostic(mainUri, expectedDiagnostic2);
        }).timeout(2 * 60 * 1000); // Allow 2 minutes to build

        test("Provides clang diagnostics", async () => {
            // Build for indexing
            const task = createBuildAllTask(cFolderContext);
            await executeTaskAndWaitForResult(task);

            // Open file
            const promise = Promise.resolve(); //  waitForDiagnostics([cUri], false);
            const document = await vscode.workspace.openTextDocument(cUri);
            await vscode.languages.setTextDocumentLanguage(document, "c");
            await vscode.window.showTextDocument(document);

            // Retrigger diagnostics
            await workspaceContext.focusFolder(cFolderContext);
            await promise;

            const expectedDiagnostic1 = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(5, 10), new vscode.Position(5, 13)),
                "Use of undeclared identifier 'bar'",
                vscode.DiagnosticSeverity.Error
            );
            expectedDiagnostic1.source = "clang"; // Set by LSP
            assertHasDiagnostic(cUri, expectedDiagnostic1);

            // Remove "(fix available)" from string from SourceKit
            const expectedDiagnostic2 = new vscode.Diagnostic(
                new vscode.Range(new vscode.Position(7, 4), new vscode.Position(7, 10)),
                "Expected ';' after expression",
                vscode.DiagnosticSeverity.Error
            );
            expectedDiagnostic2.source = "clang"; // Set by LSP
            assertHasDiagnostic(cUri, expectedDiagnostic2);
        }).timeout(2 * 60 * 1000); // Allow 2 minutes to build
    });
});
