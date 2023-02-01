//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { FolderEvent, WorkspaceContext } from "../WorkspaceContext";
import { LcovResults } from "./LcovResults";

export class TestCoverageRenderer implements vscode.Disposable {
    private displayResults: boolean;
    private subscriptions: { dispose(): unknown }[];
    private currentEditor: vscode.TextEditor | undefined;
    private coverageDecorationType: vscode.TextEditorDecorationType;
    private noCoverageDecorationType: vscode.TextEditorDecorationType;

    constructor(private workspaceContext: WorkspaceContext) {
        this.displayResults = false;
        this.currentEditor = vscode.window.activeTextEditor;
        const coverageDecorationType: vscode.DecorationRenderOptions = {
            isWholeLine: true,
            dark: {
                backgroundColor: "#004000",
                overviewRulerColor: "#004000",
            },
            light: {
                backgroundColor: "#c0ffc0",
                overviewRulerColor: "#c0ffc0",
            },
        };
        const noCoverageDecorationType: vscode.DecorationRenderOptions = {
            isWholeLine: true,
            dark: {
                backgroundColor: "#400000",
                overviewRulerColor: "#400000",
            },
            light: {
                backgroundColor: "#ffc0c0",
                overviewRulerColor: "#ffc0c0",
            },
        };
        this.coverageDecorationType =
            vscode.window.createTextEditorDecorationType(coverageDecorationType);
        this.noCoverageDecorationType =
            vscode.window.createTextEditorDecorationType(noCoverageDecorationType);

        const folderAddedObserver = workspaceContext.observeFolders((folder, event) => {
            if (!folder) {
                return;
            }
            switch (event) {
                case FolderEvent.add:
                    folder.lcovResults.observer = results => {
                        this.resultsChanged(results);
                    };
            }
        });
        // add event listener for when the active edited text document changes
        const onDidChangeActiveWindow = vscode.window.onDidChangeActiveTextEditor(async editor => {
            if (this.currentEditor) {
                this.clear(this.currentEditor);
            }
            if (editor) {
                this.render(editor);
                this.currentEditor = editor;
            }
        });
        this.subscriptions = [
            folderAddedObserver,
            onDidChangeActiveWindow,
            this.coverageDecorationType,
            this.noCoverageDecorationType,
        ];
    }

    dispose() {
        this.subscriptions.forEach(item => item.dispose());
    }

    toggleDisplayResults() {
        if (this.displayResults === true) {
            this.displayResults = false;
            if (this.currentEditor) {
                this.clear(this.currentEditor);
            }
        } else {
            this.displayResults = true;
            if (this.currentEditor) {
                this.render(this.currentEditor);
            }
        }
    }

    private resultsChanged(results: LcovResults) {
        if (results.folderContext === this.workspaceContext.currentFolder && this.currentEditor) {
            this.render(this.currentEditor);
        }
    }

    private render(editor: vscode.TextEditor) {
        // clear previous results
        this.clear(editor);

        const folder = this.workspaceContext.currentFolder;
        if (!folder || !this.displayResults) {
            return;
        }
        const results = folder.lcovResults.resultsForFile(editor?.document.fileName);
        if (!results) {
            return;
        }
        const hits = results.lines.details.filter(line => line.hit > 0);
        const misses = results.lines.details.filter(line => line.hit === 0);
        if (hits.length > 0) {
            const ranges = hits.map(line => {
                return new vscode.Range(
                    new vscode.Position(line.line - 1, 0),
                    new vscode.Position(line.line - 1, 0)
                );
            });
            editor.setDecorations(this.coverageDecorationType, ranges);
        }
        if (misses.length > 0) {
            const ranges = misses.map(line => {
                return new vscode.Range(
                    new vscode.Position(line.line - 1, 0),
                    new vscode.Position(line.line - 1, 0)
                );
            });
            editor.setDecorations(this.noCoverageDecorationType, ranges);
        }
    }

    private clear(editor: vscode.TextEditor) {
        editor.setDecorations(this.coverageDecorationType, []);
        editor.setDecorations(this.noCoverageDecorationType, []);
    }
}
