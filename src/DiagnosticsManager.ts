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

import * as vscode from "vscode";
import stripAnsi = require("strip-ansi");
import configuration from "./configuration";
import { SwiftExecution } from "./tasks/SwiftExecution";
import { WorkspaceContext } from "./WorkspaceContext";

interface ParsedDiagnostic {
    uri: string;
    diagnostic: vscode.Diagnostic;
}

type DiagnosticsMap = Map<string, vscode.Diagnostic[]>;

/**
 * Handles the collection and deduplication of diagnostics from
 * various {@link vscode.Diagnostic.source | Diagnostic sources}.
 *
 * Listens for running {@link SwiftExecution} tasks and allows
 * external clients to call {@link handleDiagnostics} to provide
 * thier own diagnostics.
 */
export class DiagnosticsManager implements vscode.Disposable {
    // Prior to Swift 6 "sourcekitd" was the source
    static sourcekit: string[] = ["SourceKit", "sourcekitd"];
    static swiftc: string[] = ["swiftc"];

    private diagnosticCollection: vscode.DiagnosticCollection =
        vscode.languages.createDiagnosticCollection("swift");

    constructor(context: WorkspaceContext) {
        this.onDidStartTaskDisposible = vscode.tasks.onDidStartTask(event => {
            // Will only try to provide diagnostics for `swift` tasks
            const execution = event.execution.task.execution;
            if (!(execution && execution instanceof SwiftExecution)) {
                return;
            }
            // Clean up old "swiftc" diagnostics
            this.removeBuildDiagnostics();
            if (!this.includeSwiftcDiagnostics()) {
                return;
            }
            // Provide new list of diagnostics
            const swiftExecution = execution as SwiftExecution;
            const provideDiagnostics: Promise<DiagnosticsMap> =
                this.parseDiagnostics(swiftExecution);

            provideDiagnostics
                .then(map =>
                    map.forEach((diagnostics, uri) =>
                        this.handleDiagnostics(
                            vscode.Uri.file(uri),
                            DiagnosticsManager.swiftc,
                            diagnostics
                        )
                    )
                )
                .catch(e =>
                    context.outputChannel.log(`${e}`, 'Failed to provide "swiftc" diagnostics')
                );
        });
    }

    /**
     * Provide a new list of diagnostics for a given file
     *
     * @param uri {@link vscode.Uri Uri} of the file these diagonstics apply to
     * @param sources The source of the diagnostics which will apply for cleaning
     * up diagnostics that have been removed. See {@link swiftc} and {@link sourcekit}
     * @param diagnostics Array of {@link vscode.Diagnostic}. This can be empty to remove old diagnostics for the specified `sources`.
     */
    handleDiagnostics(uri: vscode.Uri, sources: string[], diagnostics: vscode.Diagnostic[]): void {
        // Is a descrepency between SourceKit-LSP and older versions
        // of Swift as to whether the first letter is capitalized or not,
        // so we'll always display messages capitalized to user and this
        // also will allow comparing messages when merging
        diagnostics.forEach(this.capitalizeMessage);
        // Remove the old set of benefits from this source
        const currentDiagnostics = this.removeDiagnostics(
            this.diagnosticCollection.get(uri)?.slice() || [],
            sources
        );
        let newDiagnostics: vscode.Diagnostic[];
        switch (configuration.diagnosticsCollection) {
            case "keepSourceKit":
                newDiagnostics = this.mergeDiagnostics(
                    currentDiagnostics,
                    diagnostics,
                    DiagnosticsManager.sourcekit
                );
                break;
            case "keepSwiftc":
                newDiagnostics = this.mergeDiagnostics(
                    currentDiagnostics,
                    diagnostics,
                    DiagnosticsManager.swiftc
                );
                break;
            case "onlySourceKit":
                newDiagnostics = this.removeDiagnostics(
                    currentDiagnostics,
                    DiagnosticsManager.swiftc
                ); // Just in case
                if (DiagnosticsManager.swiftc.find(s => sources.includes(s))) {
                    break;
                }
                newDiagnostics.push(...diagnostics);
                break;
            case "onlySwiftc":
                newDiagnostics = this.removeDiagnostics(
                    currentDiagnostics,
                    DiagnosticsManager.sourcekit
                ); // Just in case
                if (DiagnosticsManager.sourcekit.find(s => sources.includes(s))) {
                    break;
                }
                newDiagnostics.push(...diagnostics);
                break;
            case "keepAll":
                newDiagnostics = currentDiagnostics.concat(diagnostics);
                break;
        }
        this.diagnosticCollection.set(uri, newDiagnostics);
    }

    private mergeDiagnostics(
        currentDiagnostics: vscode.Diagnostic[],
        newDiagnostics: vscode.Diagnostic[],
        precedence: string[]
    ): vscode.Diagnostic[] {
        const merged: vscode.Diagnostic[] = [];
        for (const diagnostic of newDiagnostics) {
            // See if a duplicate diagnostic exists
            const currentDiagnostic = currentDiagnostics.find(
                d =>
                    d.range.start.isEqual(diagnostic.range.start) &&
                    d.message === diagnostic.message
            );
            if (currentDiagnostic) {
                currentDiagnostics.splice(currentDiagnostics.indexOf(currentDiagnostic), 1);
            }

            // Perform de-duplication
            if (precedence.includes(diagnostic.source || "")) {
                merged.push(diagnostic);
                continue;
            }
            if (!currentDiagnostic || !precedence.includes(currentDiagnostic.source || "")) {
                merged.push(diagnostic);
                continue;
            }
            merged.push(currentDiagnostic);
        }
        // Add all remaining old diagnostics that had no collision
        merged.push(...currentDiagnostics);
        return merged;
    }

    private removeBuildDiagnostics() {
        this.diagnosticCollection.forEach((uri, diagnostics) => {
            const newDiagnostics = this.removeDiagnostics(diagnostics, DiagnosticsManager.swiftc);
            if (diagnostics.length !== newDiagnostics.length) {
                this.diagnosticCollection.set(uri, newDiagnostics);
            }
        });
    }

    private removeDiagnostics(
        diagnostics: readonly vscode.Diagnostic[],
        sources: string[]
    ): vscode.Diagnostic[] {
        return diagnostics.filter(d => !sources.includes(d.source || ""));
    }

    /**
     * Clear the `swift` diagnostics collection. Mostly meant for testing purposes.
     */
    clear(): void {
        this.diagnosticCollection.clear();
    }

    dispose() {
        this.diagnosticCollection.dispose();
        this.onDidStartTaskDisposible.dispose();
    }

    private includeSwiftcDiagnostics(): boolean {
        return configuration.diagnosticsCollection !== "onlySourceKit";
    }

    private parseDiagnostics(swiftExecution: SwiftExecution): Promise<DiagnosticsMap> {
        return new Promise<DiagnosticsMap>(res => {
            const diagnostics = new Map();
            const disposables: vscode.Disposable[] = [];
            const done = () => {
                disposables.forEach(d => d.dispose());
                res(diagnostics);
            };
            let remainingData: string | undefined;
            let lastDiagnostic: vscode.Diagnostic | undefined;
            disposables.push(
                swiftExecution.onDidWrite(data => {
                    const sanitizedData = (remainingData || "") + stripAnsi(data);
                    const lines = sanitizedData.split(/\r\n|\n|\r/gm);
                    // If ends with \n then will be "" and there's no affect.
                    // Otherwise want to keep remaining data to pre-pend next write
                    remainingData = lines.pop();
                    for (const line of lines) {
                        const result = this.parseDiagnostic(line);
                        if (!result) {
                            continue;
                        }
                        if (
                            result instanceof vscode.DiagnosticRelatedInformation &&
                            lastDiagnostic
                        ) {
                            const relatedInformation =
                                result as vscode.DiagnosticRelatedInformation;
                            this.capitalizeMessage(relatedInformation);
                            lastDiagnostic.relatedInformation = (
                                lastDiagnostic.relatedInformation || []
                            ).concat(relatedInformation);
                            continue;
                        }
                        const { uri, diagnostic } = result as ParsedDiagnostic;

                        const currentUriDiagnostics: vscode.Diagnostic[] =
                            diagnostics.get(uri) || [];
                        if (
                            currentUriDiagnostics.find(
                                d =>
                                    d.message === diagnostic.message &&
                                    d.range.isEqual(diagnostic.range)
                            )
                        ) {
                            // De-duplicate duplicate diagnostics from SwiftPM
                            // TODO remove when https://github.com/apple/swift/issues/73973 is fixed
                            continue;
                        }
                        lastDiagnostic = diagnostic;
                        diagnostics.set(uri, [...currentUriDiagnostics, diagnostic]);
                    }
                }),
                swiftExecution.onDidClose(done)
            );
        });
    }

    private parseDiagnostic(
        line: string
    ): ParsedDiagnostic | vscode.DiagnosticRelatedInformation | undefined {
        const diagnosticRegex = /^(.*?):(\d+)(?::(\d+))?:\s+(warning|error|note):\s+(.*)$/g;
        const match = diagnosticRegex.exec(line);
        if (!match) {
            return;
        }
        const uri = match[1];
        const message = match[5];
        const range = this.range(match[2], match[3]);
        const severity = this.severity(match[4]);
        if (severity === vscode.DiagnosticSeverity.Information) {
            return new vscode.DiagnosticRelatedInformation(
                new vscode.Location(vscode.Uri.file(uri), range),
                message
            );
        }
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = DiagnosticsManager.swiftc[0];
        return { uri, diagnostic };
    }

    private range(lineString: string, columnString: string): vscode.Range {
        // Output from `swift` is 1-based but vscode expects 0-based lines and columns
        const line = parseInt(lineString) - 1;
        const col = parseInt(columnString) - 1;
        const position = new vscode.Position(line, col);
        return new vscode.Range(position, position);
    }

    private severity(severityString: string): vscode.DiagnosticSeverity {
        let severity = vscode.DiagnosticSeverity.Error;
        switch (severityString) {
            case "warning":
                severity = vscode.DiagnosticSeverity.Warning;
                break;
            case "note":
                severity = vscode.DiagnosticSeverity.Information;
                break;
            default:
                break;
        }
        return severity;
    }

    private capitalizeMessage(
        diagnostic: vscode.Diagnostic | vscode.DiagnosticRelatedInformation
    ): void {
        const message = diagnostic.message;
        diagnostic.message = message.charAt(0).toUpperCase() + message.slice(1);
    }

    private onDidStartTaskDisposible: vscode.Disposable;
}
