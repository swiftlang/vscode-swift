import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export async function createDocumentationCatalog(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        await vscode.window.showErrorMessage("Open a workspace first.");
        return;
    }

    const moduleName = await vscode.window.showInputBox({
        prompt: "Enter Swift module name",
        placeHolder: "MyModule",
        validateInput: value =>
            value.trim().length === 0 ? "Module name cannot be empty" : undefined,
    });

    if (!moduleName) {
        return; // user cancelled
    }

    const rootPath = folders[0].uri.fsPath;
    const doccDir = path.join(rootPath, `${moduleName}.docc`);
    const markdownFile = path.join(doccDir, `${moduleName}.md`);

    if (fs.existsSync(doccDir)) {
        await vscode.window.showErrorMessage(
            `Documentation catalog "${moduleName}.docc" already exists.`
        );
        return;
    }

    fs.mkdirSync(doccDir, { recursive: true });
    fs.writeFileSync(markdownFile, `# ${moduleName}\n`, { encoding: "utf8" });

    await vscode.window.showInformationMessage(
        `Created DocC documentation catalog: ${moduleName}.docc`
    );
}
