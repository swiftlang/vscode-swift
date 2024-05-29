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
import { createSwiftTask } from "../../src/tasks/SwiftTaskProvider";
import { DiagnosticsManager } from "../../src/DiagnosticsManager";

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

suite("DiagnosticsManager Test Suite", () => {
    const swiftConfig = vscode.workspace.getConfiguration("swift");

    let workspaceContext: WorkspaceContext;
    let toolchain: SwiftToolchain;
    let workspaceFolder: vscode.WorkspaceFolder;

    let mainUri: vscode.Uri;
    let funcUri: vscode.Uri;

    suiteSetup(async () => {
        workspaceContext = await WorkspaceContext.create();
        toolchain = await SwiftToolchain.create();
        workspaceFolder = testAssetWorkspaceFolder("diagnostics");
        await workspaceContext.addPackageFolder(workspaceFolder.uri, workspaceFolder);
        mainUri = vscode.Uri.file(`${workspaceFolder.uri.path}/Sources/main.swift`);
        funcUri = vscode.Uri.file(`${workspaceFolder.uri.path}/Sources/func.swift`);
    });

    setup(async () => {
        await waitForNoRunningTasks();
        workspaceContext.diagnostics.clear();
    });

    suite("Parse diagnostics", async () => {
        test("Parse from task output", async () => {
            // Run actual task
            const promise = waitForDiagnostics([mainUri, funcUri]);
            const task = createSwiftTask(
                ["build"],
                "Build All",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                toolchain
            );
            await executeTaskAndWaitForResult(task);
            await promise;
            await waitForNoRunningTasks();

            let diagnostics = vscode.languages.getDiagnostics(mainUri);
            // Should have parsed severity
            assert.notEqual(
                diagnostics.find(
                    d =>
                        d.severity === vscode.DiagnosticSeverity.Warning &&
                        d.source === "swiftc" &&
                        d.message ===
                            "Initialization of variable 'unused' was never used; consider replacing with assignment to '_' or removing it" && // Note capitalized to match sourcekit-lsp
                        d.range.isEqual(
                            new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 8))
                        )
                ),
                undefined
            );
            assert.notEqual(
                diagnostics.find(
                    d =>
                        d.severity === vscode.DiagnosticSeverity.Error &&
                        d.source === "swiftc" &&
                        d.message === "Cannot assign to value: 'bar' is a 'let' constant" && // Note capitalized to match sourcekit-lsp
                        d.range.isEqual(
                            new vscode.Range(new vscode.Position(7, 0), new vscode.Position(7, 0))
                        )
                ),
                undefined
            );
            // Check parsed for other file
            diagnostics = vscode.languages.getDiagnostics(funcUri);
            assert.notEqual(
                diagnostics.find(
                    d =>
                        d.severity === vscode.DiagnosticSeverity.Error &&
                        d.source === "swiftc" &&
                        d.message === "Cannot find 'baz' in scope" && // Note capitalized to match sourcekit-lsp
                        d.range.isEqual(
                            new vscode.Range(new vscode.Position(1, 4), new vscode.Position(1, 4))
                        )
                ),
                undefined
            );
        }).timeout(2 * 60 * 1000); // Allow 2 minutes to build

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
            const diagnostics = vscode.languages.getDiagnostics(mainUri);
            // Should have parsed severity
            assert.notEqual(
                diagnostics.find(
                    d =>
                        d.severity === vscode.DiagnosticSeverity.Error &&
                        d.source === "swiftc" &&
                        d.message === "Cannot find 'foo' in scope" && // Note capitalized to match sourcekit-lsp
                        d.range.isEqual(
                            new vscode.Range(new vscode.Position(12, 4), new vscode.Position(12, 4))
                        )
                ),
                undefined
            );
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
            assert.notEqual(
                diagnostics.find(
                    d =>
                        d.severity === vscode.DiagnosticSeverity.Error &&
                        d.source === "swiftc" &&
                        d.message === "Cannot find 'foo' in scope" && // Note capitalized to match sourcekit-lsp
                        d.range.isEqual(
                            new vscode.Range(new vscode.Position(12, 4), new vscode.Position(12, 4))
                        )
                ),
                undefined
            );
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
            swiftcErrorDiagnostic.source = "swiftc";
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
            sourcekitErrorDiagnostic.source = "SourceKit";
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                // swiftc deduplicated
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), false);
                // kept unique swiftc diagnostic
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                // swiftc deduplicated
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), false);
                // kept unique swiftc diagnostic
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                // swiftc ignored
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), false);
                // kept unique swiftc diagnostic
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), true);
            });

            test("no SourceKit diagnostics", async () => {
                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                // check added all diagnostics into collection
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), true);
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

                // check SourceKit merged in
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.notEqual(
                    diagnostics.find(
                        d =>
                            d.message === sourcekitErrorDiagnostic.message && // Note capitalized
                            d.range.isEqual(sourcekitErrorDiagnostic.range)
                    ),
                    undefined
                );
                // swiftc deduplicated
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), false);
                assert.equal(diagnostics.includes(swiftcLowercaseDiagnostic), false);
                // kept unique swiftc diagnostic
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                // SourceKit deduplicated
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                // kept unique SourceKit diagnostic
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                // swiftc ignored
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                // kept unique SourceKit diagnostic
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
            });

            test("no swiftc diagnostics", async () => {
                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // check added all diagnostics into collection
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.notEqual(
                    diagnostics.find(
                        d =>
                            d.message === swiftcErrorDiagnostic.message && // Note capitalized
                            d.range.isEqual(swiftcErrorDiagnostic.range)
                    ),
                    undefined
                );
                // SourceKit deduplicated
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                // kept unique SourceKit diagnostic
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                // SourceKit deduplicated
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                // kept unique SourceKit diagnostic
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                // swiftc ignored
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                // kept unique SourceKit diagnostic
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
            });

            test("no swiftc diagnostics", async () => {
                // Now provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                // check added all diagnostics into collection
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                // ignored swiftc
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), false);
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), false);
            });

            test("ignore swiftc diagnostics", async () => {
                // Provide swiftc diagnostics
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);

                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                // ignored swiftc
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), false);
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), false);
            });

            test("clean old swiftc diagnostics", async () => {
                // Add initial swiftc diagnostics
                await swiftConfig.update("diagnosticsCollection", "keepAll");
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                    swiftcWarningDiagnostic,
                ]);
                let diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                assert.equal(diagnostics.includes(swiftcWarningDiagnostic), true);

                // Now change to onlySourceKit and provide identical SourceKit diagnostic
                await swiftConfig.update("diagnosticsCollection", "onlySourceKit");
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic]
                );

                // check SourceKit merged in
                diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                // cleaned swiftc
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), false);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), false);
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
                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                // ignored SourceKit
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), false);
            });

            test("ignore SourceKit diagnostics", async () => {
                // Provide SourceKit diagnostics
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );

                const diagnostics = vscode.languages.getDiagnostics(mainUri);
                // ignored SourceKit
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), false);
            });

            test("clean old SourceKit diagnostics", async () => {
                // Add initial SourceKit diagnostics
                await swiftConfig.update("diagnosticsCollection", "keepAll");
                workspaceContext.diagnostics.handleDiagnostics(
                    mainUri,
                    DiagnosticsManager.sourcekit,
                    [sourcekitErrorDiagnostic, sourcekitWarningDiagnostic]
                );
                let diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), true);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), true);

                // Now change to onlySwiftc and provide identical swiftc diagnostic
                await swiftConfig.update("diagnosticsCollection", "onlySwiftc");
                workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.swiftc, [
                    swiftcErrorDiagnostic,
                ]);

                // check swiftc merged in
                diagnostics = vscode.languages.getDiagnostics(mainUri);
                assert.equal(diagnostics.includes(swiftcErrorDiagnostic), true);
                // cleaned SourceKit
                assert.equal(diagnostics.includes(sourcekitErrorDiagnostic), false);
                assert.equal(diagnostics.includes(sourcekitWarningDiagnostic), false);
            });
        });
    });
});
