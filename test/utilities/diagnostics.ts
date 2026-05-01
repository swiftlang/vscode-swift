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
import * as assert from "assert";
import * as vscode from "vscode";

import { SwiftTask } from "@src/tasks/SwiftTaskProvider";
import { Disposable } from "@src/utilities/Disposable";

import { executeTaskAndWaitForResult } from "./tasks";
import { fixProcessOutput } from "./terminal";
import { withTimeout } from "./withTimeout";

function severityToString(severity: vscode.DiagnosticSeverity): string {
    switch (severity) {
        case vscode.DiagnosticSeverity.Error:
            return "Error";
        case vscode.DiagnosticSeverity.Warning:
            return "Warning";
        case vscode.DiagnosticSeverity.Information:
            return "Information";
        case vscode.DiagnosticSeverity.Hint:
            return "Hint";
    }
}

function rangeToString(r: vscode.Range): string {
    return `[start: [${r.start.line}:${r.start.character}], end: [${r.end.line}:${r.end.character}]]`;
}

function diagnosticToString(d: vscode.Diagnostic): string {
    return `[${severityToString(d.severity)}] ${rangeToString(d.range)} ${d.message}`;
}

function diagnosticMapToString(map: Map<vscode.Uri, vscode.Diagnostic[]>): string {
    const mapArray = Array.from(map.entries())
        .map<[string, vscode.Diagnostic[]]>(([uri, diagnostics]) => [uri.fsPath, diagnostics])
        .sort(([pathA], [pathB]) => pathA.localeCompare(pathB));
    const mapObject: { [key: string]: string[] } = {};
    for (const [filePath, diagnostics] of mapArray) {
        mapObject[filePath] = diagnostics.map(diagnosticToString);
    }
    return JSON.stringify(mapObject, undefined, 2);
}

function isEqual(d1: vscode.Diagnostic, d2: vscode.Diagnostic): boolean {
    return (
        d1.severity === d2.severity &&
        d1.source === d2.source &&
        d1.message === d2.message &&
        d1.range.isEqual(d2.range)
    );
}

export function diagnosticMatcher(expected: vscode.Diagnostic): (d: vscode.Diagnostic) => boolean {
    return d => isEqual(d, expected);
}

export function assertHasDiagnostic(
    uri: vscode.Uri,
    expected: vscode.Diagnostic
): vscode.Diagnostic {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const diagnostic = diagnostics.find(diagnosticMatcher(expected));
    assert.notEqual(
        diagnostic,
        undefined,
        `Could not find diagnostic matching:\n${JSON.stringify(expected)}\nDiagnostics found:\n${JSON.stringify(diagnostics)}`
    );
    return diagnostic!;
}

export function assertWithoutDiagnostic(uri: vscode.Uri, expected: vscode.Diagnostic) {
    const diagnostics = vscode.languages.getDiagnostics(uri);
    assert.equal(
        diagnostics.find(diagnosticMatcher(expected)),
        undefined,
        `Unexpected diagnostic matching:\n${JSON.stringify(expected)}\nDiagnostics:\n${JSON.stringify(diagnostics)}`
    );
}

export type ExpectedDiagnostics = { [uri: string]: vscode.Diagnostic[] };

export function waitForDiagnosticsCleared(uri: vscode.Uri): Promise<void> {
    return new Promise<void>(resolve => {
        const diagnosticDisposable = vscode.languages.onDidChangeDiagnostics(() => {
            if (vscode.languages.getDiagnostics(uri).length === 0) {
                diagnosticDisposable?.dispose();
                resolve();
            }
        });
    });
}

function filterDiagnosticsFromVSCode(
    expectedDiagnostics: Map<vscode.Uri, vscode.Diagnostic[]>
): Map<vscode.Uri, vscode.Diagnostic[]> {
    const allRemainingDiagnostics = new Map<vscode.Uri, vscode.Diagnostic[]>();
    for (const [fileUri, expectedFileDiagnostics] of expectedDiagnostics.entries()) {
        const fileDiagnostics = vscode.languages.getDiagnostics(fileUri);
        const remainingFileDiagnostics = expectedFileDiagnostics.filter(
            d => fileDiagnostics.findIndex(diagnosticMatcher(d)) < 0
        );
        if (remainingFileDiagnostics.length > 0) {
            allRemainingDiagnostics.set(fileUri, remainingFileDiagnostics);
        }
    }
    return allRemainingDiagnostics;
}

/**
 * Waits for the provided diagnostics to be reported by VS Code.
 *
 * If the diagnostics do not appear after a short timeout then the promise will be rejected. The error
 * message contains information about which diagnostics were not found.
 *
 * @param expectedDiagnostics The diagnostics that should be present.
 */
export function waitForDiagnostics(expectedDiagnostics: ExpectedDiagnostics): Promise<void> {
    let remainingDiagnostics = new Map<vscode.Uri, vscode.Diagnostic[]>();
    Object.keys(expectedDiagnostics).forEach(filePath => {
        remainingDiagnostics.set(vscode.Uri.file(filePath), expectedDiagnostics[filePath]);
    });
    remainingDiagnostics = filterDiagnosticsFromVSCode(remainingDiagnostics);
    if (remainingDiagnostics.size === 0) {
        return Promise.resolve();
    }

    // If there are outsanding diagnostics then we need to wait for them to arrive
    const subscriptions: Disposable[] = [];
    return withTimeout<void>(
        token =>
            new Promise<void>(resolve => {
                subscriptions.push(
                    token.onCancellationRequested(resolve),
                    vscode.languages.onDidChangeDiagnostics(() => {
                        remainingDiagnostics = filterDiagnosticsFromVSCode(remainingDiagnostics);
                        if (remainingDiagnostics.size === 0) {
                            resolve();
                        }
                    })
                );
            }),
        10_000
    )
        .catch(error => {
            throw Error(
                `The following diagnostics were not found: ${diagnosticMapToString(remainingDiagnostics)}`,
                { cause: error }
            );
        })
        .finally(() => subscriptions.forEach(s => s.dispose()));
}

export async function executeTaskAndWaitForDiagnostics(
    task: SwiftTask | Promise<SwiftTask>,
    expectedDiagnostics: ExpectedDiagnostics
): Promise<void> {
    const { output: taskOutput } = await executeTaskAndWaitForResult(await task);
    return waitForDiagnostics(expectedDiagnostics).catch(async error => {
        throw Error(
            `Failed to get diagnostics after running the task. Task output:\n\n${await fixProcessOutput(taskOutput)}`,
            { cause: error }
        );
    });
}
