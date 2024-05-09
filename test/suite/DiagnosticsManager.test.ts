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

const waitForDiagnostics = () => new Promise(res => vscode.languages.onDidChangeDiagnostics(res));

suite("DiagnosticsManager Test Suite", function () {
    this.timeout(60000);

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
        const promise = waitForDiagnostics();
        const task = createSwiftTask(
            ["build"],
            "Build All",
            { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
            toolchain
        );
        await executeTaskAndWaitForResult(task);
        await promise;
        await waitForNoRunningTasks();
    });

    test("Parse diagnostics", async () => {
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
    });

    test("Parse partial line", async () => {
        const fixture = testSwiftTask("swift", ["build"], workspaceFolder, toolchain);
        const diagnosticsPromise = waitForDiagnostics();
        await vscode.tasks.executeTask(fixture.task);
        // Wait to spawn before writing
        vscode.tasks.onDidStartTask(() => {
            fixture.process.write(`${mainUri.fsPath}:13:5: err`, "");
            fixture.process.write("or: cannot find 'fo", "");
            fixture.process.write("o' in scope");
            fixture.process.close(0);
        });
        await diagnosticsPromise;
        const diagnostics = vscode.languages.getDiagnostics(mainUri);
        // Should have parsed severity
        assert.notEqual(
            diagnostics.find(
                d =>
                    d.severity === vscode.DiagnosticSeverity.Error &&
                    d.source === "swiftc" &&
                    d.message === "Cannot find 'foo' in scope" // Note capitalized to match sourcekit-lsp
            ),
            undefined
        );
    });

    test("merge sourcekitd diagnostics", async () => {
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(new vscode.Position(1, 8), new vscode.Position(1, 14)),
            "Cannot assign to value: 'bar' is a 'let' constant",
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = "sourcekitd";
        workspaceContext.diagnostics.handleDiagnostics(mainUri, DiagnosticsManager.sourcekit, [
            diagnostic,
        ]);
        const diagnostics = vscode.languages.getDiagnostics(mainUri);
        // sourcekitd merged in
        assert.notEqual(
            diagnostics.find(d => d === diagnostic),
            undefined
        );
        // swiftc deduplicated
        assert.equal(
            diagnostics.find(
                d =>
                    d.severity === vscode.DiagnosticSeverity.Error &&
                    d.source === "swiftc" &&
                    d.message === "Cannot assign to value: 'bar' is a 'let' constant"
            ),
            undefined
        );
    });
});
