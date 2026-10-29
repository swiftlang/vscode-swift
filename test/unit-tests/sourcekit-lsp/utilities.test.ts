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

import { keepPullingDiagnostics } from "@src/sourcekit-lsp/client/utilities";

suite("SourceKit-LSP client utilities Test Suite", () => {
    suite("keepPullingDiagnostics", () => {
        const document = vscode.Uri.file("/ws/Sources/App/main.swift");
        const token = new vscode.CancellationTokenSource().token;
        const noLanguageService = new ResponseError(-32001, "No language service found");

        test("returns the server's report", async () => {
            const report: vsdiag.DocumentDiagnosticReport = {
                kind: vsdiag.DocumentDiagnosticReportKind.full,
                items: [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 1), "error")],
            };

            await expect(
                keepPullingDiagnostics(document, undefined, token, async () => report)
            ).to.eventually.equal(report);
        });

        test("reports no diagnostics when the first pull fails", async () => {
            await expect(
                keepPullingDiagnostics(document, undefined, token, async () => {
                    throw noLanguageService;
                })
            ).to.eventually.deep.equal({
                kind: vsdiag.DocumentDiagnosticReportKind.full,
                items: [],
            });
        });

        test("keeps the previous diagnostics when a later pull fails", async () => {
            await expect(
                keepPullingDiagnostics(document, "3", token, async () => {
                    throw noLanguageService;
                })
            ).to.eventually.deep.equal({
                kind: vsdiag.DocumentDiagnosticReportKind.unChanged,
                resultId: "3",
            });
        });

        test("still passes on cancellation", async () => {
            await expect(
                keepPullingDiagnostics(document, undefined, token, async () => {
                    throw new vscode.CancellationError();
                })
            ).to.be.rejectedWith(vscode.CancellationError);
        });
    });
});
