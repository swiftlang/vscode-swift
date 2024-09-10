import * as vscode from "vscode";
import { TestKind } from "../TestExplorer/TestKind";
import { WorkspaceContext } from "../WorkspaceContext";
import { flattenTestItemCollection } from "../TestExplorer/TestUtils";

export async function runAllTestsParallel(ctx: WorkspaceContext) {
    const testExplorer = ctx.currentFolder?.testExplorer;
    if (testExplorer === undefined) {
        return;
    }

    const profile = testExplorer.testRunProfiles.find(
        profile => profile.label === TestKind.parallel
    );
    if (profile === undefined) {
        return;
    }

    const tests = flattenTestItemCollection(testExplorer.controller.items);
    const tokenSource = new vscode.CancellationTokenSource();
    await profile.runHandler(
        new vscode.TestRunRequest(tests, undefined, profile),
        tokenSource.token
    );
}
