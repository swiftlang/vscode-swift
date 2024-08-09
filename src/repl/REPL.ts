//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import {
    Disposable,
    NotebookController,
    NotebookDocument,
    NotebookCellOutput,
    NotebookCellOutputItem,
    notebooks,
    workspace,
    NotebookEditor,
    ViewColumn,
    TabInputNotebook,
    commands,
    window,
    NotebookControllerAffinity,
    NotebookCellData,
    NotebookEdit,
    WorkspaceEdit,
} from "vscode";
import { ChildProcess, spawn } from "child_process";
import { createInterface, Interface } from "readline";
import { WorkspaceContext } from "../WorkspaceContext";
import { NotebookCellKind } from "vscode-languageclient";

export interface ExecutionResult {
    status: boolean;
    output: string | undefined;
}

export interface IREPL {
    execute(code: string): Promise<ExecutionResult | undefined>;
    interrupt(): void;
}

class REPLConnection implements IREPL {
    private stdout: Interface;
    private stderr: Interface;

    constructor(private repl: ChildProcess) {
        this.stdout = createInterface({ input: repl.stdout as NodeJS.ReadableStream });
        this.stderr = createInterface({ input: repl.stderr as NodeJS.ReadableStream });
        this.stdout.on("line", line => {
            console.log(`=> ${line}`);
        });
        this.stderr.on("line", line => {
            console.log(`=> ${line}`);
        });
    }

    public async execute(code: string): Promise<ExecutionResult | undefined> {
        if (!code.endsWith("\n")) {
            code += "\n";
        }
        if (!this.repl.stdin?.write(code)) {
            return Promise.resolve({ status: false, output: undefined });
        }
        return new Promise((resolve, _reject) => {
            this.stdout.on("line", line => {
                return resolve({ status: true, output: line });
            });

            const lines: string[] = [];
            this.stderr.on("line", line => {
                lines.push(line);
                if (!line) {
                    return resolve({ status: false, output: lines.join("\n") });
                }
            });
        });
    }

    public interrupt(): void {
        this.repl.stdin?.write(":q");
    }
}

export class REPL implements Disposable {
    private repl: REPLConnection;
    private controller: NotebookController;
    private document: NotebookDocument | undefined;
    private listener: Disposable | undefined;

    constructor(workspace: WorkspaceContext) {
        const repl = spawn(workspace.toolchain.getToolchainExecutable("swift"), ["repl"]);
        repl.on("exit", (code, _signal) => {
            console.error(`repl exited with code ${code}`);
        });
        repl.on("error", error => {
            console.error(`repl error: ${error}`);
        });

        this.repl = new REPLConnection(repl);

        this.controller = notebooks.createNotebookController(
            "SwiftREPL",
            "interactive",
            "Swift REPL"
        );
        this.controller.supportedLanguages = ["swift"];
        this.controller.supportsExecutionOrder = true;
        this.controller.description = "Swift REPL";
        this.controller.interruptHandler = async () => {
            this.repl.interrupt();
        };
        this.controller.executeHandler = async (cells, _notebook, controller) => {
            for (const cell of cells) {
                const execution = controller.createNotebookCellExecution(cell);
                execution.start(Date.now());

                const result = await this.repl.execute(cell.document.getText());
                if (result?.output) {
                    execution.replaceOutput([
                        new NotebookCellOutput([
                            NotebookCellOutputItem.text(result.output, "text/plain"),
                        ]),
                    ]);
                }

                execution.end(result?.status);
            }
        };

        this.watchNotebookClose();
    }

    dispose(): void {
        this.controller.dispose();
        this.listener?.dispose();
    }

    private watchNotebookClose() {
        this.listener = workspace.onDidCloseNotebookDocument(notebook => {
            if (notebook.uri.toString() === this.document?.uri.toString()) {
                this.document = undefined;
            }
        });
    }

    private getNotebookColumn(): ViewColumn | undefined {
        const uri = this.document?.uri.toString();
        return window.tabGroups.all.flatMap(group => {
            return group.tabs.flatMap(tab => {
                if (tab.label === "Swift REPL") {
                    if ((tab.input as TabInputNotebook)?.uri.toString() === uri) {
                        return tab.group.viewColumn;
                    }
                }
                return undefined;
            });
        })?.[0];
    }

    public async evaluate(code: string): Promise<void> {
        let editor: NotebookEditor | undefined;
        if (this.document) {
            const column = this.getNotebookColumn() ?? ViewColumn.Beside;
            editor = await window.showNotebookDocument(this.document!, { viewColumn: column });
        } else {
            const notebook = (await commands.executeCommand(
                "interactive.open",
                {
                    preserveFocus: true,
                    viewColumn: ViewColumn.Beside,
                },
                undefined,
                this.controller.id,
                "Swift REPL"
            )) as { notebookEditor: NotebookEditor };
            editor = notebook.notebookEditor;
            this.document = editor.notebook;
        }

        if (this.document) {
            this.controller.updateNotebookAffinity(
                this.document,
                NotebookControllerAffinity.Default
            );

            await commands.executeCommand("notebook.selectKernel", {
                notebookEdtior: this.document,
                id: this.controller.id,
                extension: "sswg.swift-lang",
            });

            const edit = new WorkspaceEdit();
            edit.set(this.document.uri, [
                NotebookEdit.insertCells(this.document.cellCount, [
                    new NotebookCellData(NotebookCellKind.Code, code, "swift"),
                ]),
            ]);
            workspace.applyEdit(edit);

            commands.executeCommand("notebook.cell.execute", {
                ranges: [{ start: this.document.cellCount, end: this.document.cellCount + 1 }],
                document: this.document.uri,
            });
        }
    }
}
