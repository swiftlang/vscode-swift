//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
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
import { SwiftOutputChannel } from "../../src/ui/SwiftOutputChannel";

const waitForDiagnostics = (uris: vscode.Uri[]) =>
    new Promise<void>(res =>
        vscode.languages.onDidChangeDiagnostics(e => {
            const paths = e.uris.map(u => u.path);
            for (const uri of uris) {
                if (!paths.includes(uri.path)) {
                    return;
                }
            }
            res();
        })
    );

const isEqual = (d1: vscode.Diagnostic, d2: vscode.Diagnostic) =>
    d1.severity === d2.severity &&
    d1.source === d2.source &&
    d1.message === d2.message &&
    d1.range.isEqual(d2.range);

const findDiagnostic = (expected: vscode.Diagnostic) => (d: vscode.Diagnostic) =>
    isEqual(d, expected);

function assertHasDiagnostic(uri: vscode.Uri, expected: vscode.Diagnostic): vscode.Diagnostic {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const diagnostic = diagnostics.find(findDiagnostic(expected));
    assert.notEqual(
        diagnostic,
        undefined,
        `Could not find diagnostic matching:\n${JSON.stringify(expected)}`
    );
    return diagnostic!;
}

function assertWithoutDiagnostic(uri: vscode.Uri, expected: vscode.Diagnostic) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    assert.equal(
        diagnostics.find(findDiagnostic(expected)),
        undefined,
        `Unexpected diagnostic matching:\n${JSON.stringify(expected)}`
    );
}

suite("DiagnosticsManager Test Suite", () => {
    const swiftConfig = vscode.workspace.getConfiguration("swift");

    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;

    let mainUri: vscode.Uri;
    let funcUri: vscode.Uri;

    suiteSetup(async () => {
        toolchain = await SwiftToolchain.create();
        workspaceContext = await WorkspaceContext.create(new SwiftOutputChannel(), toolchain);
        workspaceFolder = testAssetWorkspaceFolder("diagnostics");
        folderContext = await workspaceContext.addPackageFolder(
            workspaceFolder.uri,
            workspaceFolder
        );
        mainUri = vscode.Uri.file(`${workspaceFolder.uri.path}/Sources/main.swift`);
        funcUri = vscode.Uri.file(`${workspaceFolder.uri.path}/Sources/func.swift`);
    });

    suite("Parse diagnostics", async () => {
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

            setup(async () => {
                await waitForNoRunningTasks();
                workspaceContext.diagnostics.clear();
            });

            suiteTeardown(async () => {
                await swiftConfig.update("diagnosticsStyle", undefined);
            });

            test("default diagnosticsStyle", async () => {
                await swiftConfig.update("diagnosticsStyle", "default");
                const task = createBuildAllTask(folderContext);
                // Run actual task
                const promise = waitForDiagnostics([mainUri, funcUri]);
                await executeTaskAndWaitForResult(task);
                await promise;
                await waitForNoRunningTasks();

                // Should have parsed correct severity
                assertHasDiagnostic(mainUri, expectedWarningDiagnostic);
                assertHasDiagnostic(mainUri, expectedMainErrorDiagnostic);
                // Check parsed for other file
                assertHasDiagnostic(funcUri, expectedFuncErrorDiagnostic);
            }).timeout(2 * 60 * 1000); // Allow 2 minutes to build

            test("swift diagnosticsStyle", async () => {
                await swiftConfig.update("diagnosticsStyle", "swift");
                const task = createBuildAllTask(folderContext);
                // Run actual task
                const promise = waitForDiagnostics([mainUri, funcUri]);
                await executeTaskAndWaitForResult(task);
                await promise;
                await waitForNoRunningTasks();

                // Should have parsed severity
                assertHasDiagnostic(mainUri, expectedWarningDiagnostic);
                assertHasDiagnostic(mainUri, expectedMainErrorDiagnostic);
                // Check parsed for other file
                assertHasDiagnostic(funcUri, expectedFuncErrorDiagnostic);
            }).timeout(2 * 60 * 1000); // Allow 2 minutes to build

            test("llvm diagnosticsStyle", async () => {
                await swiftConfig.update("diagnosticsStyle", "llvm");
                const task = createBuildAllTask(folderContext);
                // Run actual task
                const promise = waitForDiagnostics([mainUri, funcUri]);
                await executeTaskAndWaitForResult(task);
                await promise;
                await waitForNoRunningTasks();

                // Should have parsed severity
                assertHasDiagnostic(mainUri, expectedWarningDiagnostic);
                const diagnostic = assertHasDiagnostic(mainUri, expectedMainErrorDiagnostic);
                // Should have parsed related note
                assert.equal(diagnostic.relatedInformation?.length, 1);
                assert.equal(
                    diagnostic.relatedInformation![0].message,
                    "Change 'let' to 'var' to make it mutable"
                );
                assert.deepEqual(
                    diagnostic.relatedInformation![0].location,
                    new vscode.Location(mainUri, new vscode.Position(6, 0))
                );
                // Check parsed for other file
                assertHasDiagnostic(funcUri, expectedFuncErrorDiagnostic);
            }).timeout(2 * 60 * 1000); // Allow 2 minutes to build
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
                const diagnosticsPromise = waitForDiagnostics([mainUri]);
                // Wait to spawn before writing
                fixture.process.write(`${mainUri.fsPath}:13:5: err`, "");
                fixture.process.write("or: Cannot find 'fo", "");
                fixture.process.write("o' in scope");
                fixture.process.close(1);
                await waitForNoRunningTasks();
                await diagnosticsPromise;
                // Should have parsed
                assertHasDiagnostic(mainUri, outputDiagnostic);
            });

            // https://github.com/apple/swift/issues/73973
            test("Ignore duplicates", async () => {
                const fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
                await vscode.tasks.executeTask(fixture.task);
                const diagnosticsPromise = waitForDiagnostics([mainUri]);
                // Wait to spawn before writing
                const output = `${mainUri.fsPath}:13:5: error: Cannot find 'foo' in scope`;
                fixture.process.write(output);
                fixture.process.write("some random output");
                fixture.process.write(output);
                fixture.process.close(1);
                await waitForNoRunningTasks();
                await diagnosticsPromise;
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                // Should only include one
                assert.equal(diagnostics.length, 1);
                assertHasDiagnostic(mainUri, outputDiagnostic);
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
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

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
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // Now provide identical sourcekitd diagnostic
                sourcekitErrorDiagnostic.source = "sourcekitd"; // pre-Swift 6
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // check SourceKit stayed in collection
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // swiftc ignored
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                // kept unique swiftc diagnostic
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("no SourceKit diagnostics", async () => {
                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // check added all diagnostics into collection
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("discrepency in capitalization", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // Now provide SourceKit diagnostic with different capitalization
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // SourceKit deduplicated
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // kept unique SourceKit diagnostic
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("merge in SourceKit diagnostics", async () => {
                // Add initial swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

                // Now provide SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide swiftc diagnostic with different capitalization
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcLowercaseDiagnostic,
                ]);

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // SourceKit deduplicated
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // kept unique SourceKit diagnostic
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // SourceKit deduplicated
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                // kept unique SourceKit diagnostic
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });

            test("merge in SourceKit diagnostics", async () => {
                // Add initial swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

                // Now provide SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // check added all diagnostics into collection
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });
        });

        suite("onlySourceKit", () => {
            setup(async () => {
                await swiftConfig.update("diagnosticsCollection", "onlySourceKit");
            });

            test("merge in SourceKit diagnostics", async () => {
                // Add initial swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcErrorDiagnostic,
                ]);

                // Now provide identical SourceKit diagnostic
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // ignored swiftc
                assertWithoutDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, swiftcWarningDiagnostic);
            });

            test("clean old swiftc diagnostics", async () => {
                // Add initial swiftc diagnostics
                await swiftConfig.update("diagnosticsCollection", "keepAll");
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                assertHasDiagnostic(mainUri, swiftcWarningDiagnostic);

                // Now change to onlySourceKit and provide identical SourceKit diagnostic
                await swiftConfig.update("diagnosticsCollection", "onlySourceKit");
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // Now provide identical swiftc diagnostic
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

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
                    DiagnosticsManager.sourcekit,
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
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );
                assertHasDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertHasDiagnostic(mainUri, sourcekitWarningDiagnostic);

                // Now change to onlySwiftc and provide identical swiftc diagnostic
                await swiftConfig.update("diagnosticsCollection", "onlySwiftc");
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

                // check swiftc merged in
                assertHasDiagnostic(mainUri, swiftcErrorDiagnostic);
                // cleaned SourceKit
                assertWithoutDiagnostic(mainUri, sourcekitErrorDiagnostic);
                assertWithoutDiagnostic(mainUri, sourcekitWarningDiagnostic);
            });
        });
    });
});
