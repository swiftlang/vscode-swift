import * as vscode from "vscode";
import { TestExplorer } from "./TestExplorer";
import { flattenTestItemCollection } from "./TestUtils";
import configuration from "../configuration";

export class TestCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private onDidChangeCodeLensesEmitter = new vscode.EventEmitter<void>();
    public onDidChangeCodeLenses = this.onDidChangeCodeLensesEmitter.event;
    private disposables: vscode.Disposable[] = [];

    constructor(private testExplorer: TestExplorer) {
        this.disposables = [
            testExplorer.onTestItemsDidChange(() => this.onDidChangeCodeLensesEmitter.fire()),
            vscode.languages.registerCodeLensProvider({ language: "swift", scheme: "file" }, this),
        ];
    }

    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        if (configuration.showTestCodeLenses === false) {
            return [];
        }

        const items = flattenTestItemCollection(this.testExplorer.controller.items);
        return items
            .filter(item => item.uri?.fsPath === document.uri.fsPath)
            .flatMap(item => this.codeLensesForTestItem(item));
    }

    private codeLensesForTestItem(item: vscode.TestItem): vscode.CodeLens[] {
        if (!item.range) {
            return [];
        }

        return [
            new vscode.CodeLens(item.range, {
                title: "$(play) Run",
                command: "swift.runTest",
                arguments: [item],
            }),
            new vscode.CodeLens(item.range, {
                title: "$(debug) Debug",
                command: "swift.debugTest",
                arguments: [item],
            }),
            new vscode.CodeLens(item.range, {
                title: "$(debug-coverage) Run w/ Coverage",
                command: "swift.runTestWithCoverage",
                arguments: [item],
            }),
        ];
    }
}
