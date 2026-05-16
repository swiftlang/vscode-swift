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
import * as vscode from "vscode";

import { DiagnosticsManager, getOriginalLSPMessage } from "@src/DiagnosticsManager";

import { mockObject } from "../MockUtils";

suite("DiagnosticsManager preserves the original LSP message", () => {
    // The mutation that breaks clangd lookups: stripping "(fix available)" from
    // diagnostic messages so the Problems panel reads cleaner.
    //
    // clangd matches diagnostics in `context.diagnostics` against its fix-it
    // cache using (range, message) — see ClangdLSPServer.h `struct DiagKey`.
    // If we hand back a mutated message, the lookup misses and no quickfix is
    // returned. The fix is to stash the original message on the diagnostic so
    // a `provideCodeActions` middleware can restore it before forwarding.
    test("stashes the original message before mutating it for display", () => {
        const workspaceContext = mockObject<{ logger: { error: (msg: string) => void } }>({
            logger: mockObject({ error: () => undefined }),
        });
        const manager = new DiagnosticsManager(workspaceContext as never);

        const uri = vscode.Uri.parse("file:///tmp/Foo.m");
        const diag = new vscode.Diagnostic(
            new vscode.Range(2, 16, 2, 19),
            "method definition for 'bravo:' not found (fix available)",
            vscode.DiagnosticSeverity.Warning
        );
        diag.source = "clang";
        diag.code = "-Wincomplete-implementation";

        manager.handleDiagnostics(uri, DiagnosticsManager.isSourcekit, [diag]);

        const stored = (manager.allDiagnostics.get(uri.fsPath) ?? [])[0];
        expect(stored, "diagnostic should be stored").to.not.be.undefined;
        // Display message is mutated as before.
        expect(stored.message).to.equal("Method definition for 'bravo:' not found");
        // But we kept the original for the LSP round-trip.
        expect(getOriginalLSPMessage(stored)).to.equal(
            "method definition for 'bravo:' not found (fix available)"
        );

        manager.dispose();
    });

    test("leaves the stash undefined when nothing is mutated", () => {
        const workspaceContext = mockObject<{ logger: { error: (msg: string) => void } }>({
            logger: mockObject({ error: () => undefined }),
        });
        const manager = new DiagnosticsManager(workspaceContext as never);

        const uri = vscode.Uri.parse("file:///tmp/Foo.swift");
        // An already-capitalized message with no "(fix available)" suffix —
        // capitalize and clean are both no-ops but stash should still resolve
        // to the original (== current) message.
        const diag = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 1),
            "Type 'A' has no member 'b'",
            vscode.DiagnosticSeverity.Error
        );
        diag.source = "sourcekitd";

        manager.handleDiagnostics(uri, DiagnosticsManager.isSourcekit, [diag]);

        const stored = (manager.allDiagnostics.get(uri.fsPath) ?? [])[0];
        expect(stored.message).to.equal("Type 'A' has no member 'b'");
        expect(getOriginalLSPMessage(stored)).to.equal("Type 'A' has no member 'b'");

        manager.dispose();
    });
});
