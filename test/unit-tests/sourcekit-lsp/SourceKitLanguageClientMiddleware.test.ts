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
import * as vscode from "vscode";
import { ResponseError, vsdiag } from "vscode-languageclient";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { SwiftLoggerFactory } from "@src/logging/SwiftLoggerFactory";
import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import { MockedFunction, instance, mockFn, mockObject } from "../../MockUtils";
import { TestLogger } from "../../utilities/TestLogger";

suite("SourceKitLanguageClient middleware Test Suite", () => {
    const token = new vscode.CancellationTokenSource().token;
    let fooBar: FolderContext;
    type FolderCallback = (folderContext: FolderContext) => void;
    let onDocumentCodeLens: MockedFunction<FolderCallback>;
    let onDocumentSymbols: MockedFunction<FolderCallback>;
    let client: SourceKitLanguageClient;

    function folder(fsPath: string): FolderContext {
        return instance(
            mockObject<FolderContext>({ name: fsPath, folder: vscode.Uri.file(fsPath) })
        );
    }

    function document(fsPath: string): vscode.TextDocument {
        return instance(mockObject<vscode.TextDocument>({ uri: vscode.Uri.file(fsPath) }));
    }

    setup(async () => {
        fooBar = folder("/ws/FooBar");
        onDocumentCodeLens = mockFn<FolderCallback>();
        onDocumentSymbols = mockFn<FolderCallback>();
        client = new SourceKitLanguageClient(
            instance(
                mockObject<SwiftToolchain>({
                    swiftVersion: new Version(6, 2, 0),
                    swiftFolderPath: "/toolchain/usr/bin",
                })
            ),
            instance(
                mockObject<WorkspaceContext>({
                    logger: new TestLogger(),
                    loggerFactory: instance(
                        mockObject<SwiftLoggerFactory>({
                            createOutputChannel: mockFn(s =>
                                s.returns(vscode.window.createOutputChannel("SourceKit-LSP test"))
                            ),
                        })
                    ),
                })
            ),
            { onDocumentCodeLens, onDocumentSymbols }
        );
        await client.addFolder(folder("/ws/Foo"));
        await client.addFolder(fooBar);
    });

    teardown(async () => {
        await client.dispose();
    });

    test("reports code lenses for the folder that contains the document", async () => {
        await client.clientOptions.middleware?.provideCodeLenses?.(
            document("/ws/FooBar/Sources/App/main.swift"),
            token,
            async () => []
        );

        expect(onDocumentCodeLens).to.have.been.calledOnce;
        expect(onDocumentCodeLens.firstCall.args[0].name).to.equal(fooBar.name);
    });

    test("reports document symbols for the folder that contains the document", async () => {
        await client.clientOptions.middleware?.provideDocumentSymbols?.(
            document("/ws/FooBar/Sources/App/main.swift"),
            token,
            async () => []
        );

        expect(onDocumentSymbols).to.have.been.calledOnce;
        expect(onDocumentSymbols.firstCall.args[0].name).to.equal(fooBar.name);
    });

    suite("provideDiagnostics", () => {
        const main = document("/ws/FooBar/Sources/App/main.swift");
        const noLanguageService = new ResponseError(-32001, "No language service found");

        function provideDiagnostics(
            previousResultId: string | undefined,
            next: () => Promise<vsdiag.DocumentDiagnosticReport>
        ) {
            return client.clientOptions.middleware?.provideDiagnostics?.(
                main,
                previousResultId,
                token,
                next
            );
        }

        test("returns the server's report", async () => {
            const report: vsdiag.DocumentDiagnosticReport = {
                kind: vsdiag.DocumentDiagnosticReportKind.full,
                items: [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), "error")],
            };

            await expect(provideDiagnostics(undefined, async () => report)).to.eventually.equal(
                report
            );
        });

        test("reports no diagnostics when the first pull fails", async () => {
            await expect(
                provideDiagnostics(undefined, () => Promise.reject(noLanguageService))
            ).to.eventually.deep.equal({ kind: vsdiag.DocumentDiagnosticReportKind.full, items: [] });
        });

        test("keeps the previous diagnostics when a later pull fails", async () => {
            await expect(
                provideDiagnostics("3", () => Promise.reject(noLanguageService))
            ).to.eventually.deep.equal({
                kind: vsdiag.DocumentDiagnosticReportKind.unChanged,
                resultId: "3",
            });
        });

        test("still passes on cancellation", async () => {
            await expect(
                provideDiagnostics(undefined, () => Promise.reject(new vscode.CancellationError()))
            ).to.be.rejectedWith(vscode.CancellationError);
        });
    });
});
