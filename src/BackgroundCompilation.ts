import * as vscode from "vscode";
import { WorkspaceContext } from "./WorkspaceContext";
import { isPathInsidePath } from "./utilities/utilities";
import { createBuildAllTask } from "./SwiftTaskProvider";
import configuration from "./configuration";

export function setupBackgroundCompilation(workspaceContext: WorkspaceContext): vscode.Disposable {
    const onDidSaveDocument = vscode.workspace.onDidSaveTextDocument(event => {
        if (configuration.backgroundCompilation === false) {
            return;
        }

        // is editor document in any of the current FolderContexts
        const folderContext = workspaceContext.folders.find(context => {
            return isPathInsidePath(event.uri.fsPath, context.folder.fsPath);
        });
        if (!folderContext) {
            return;
        }

        // create compile task and execute it
        const task = createBuildAllTask(folderContext);
        task.name = `${task.name} (Background)`;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
            panel: vscode.TaskPanelKind.Dedicated,
        };

        // cancel old background build task
        vscode.tasks.taskExecutions.forEach(exe => {
            if (exe.task.name === task.name && exe.task.definition.cwd === task.definition.cwd) {
                exe.terminate();
            }
        });
        // are there any tasks running inside this folder
        const index = vscode.tasks.taskExecutions.findIndex(
            exe =>
                exe.task.definition.cwd === folderContext.folder.fsPath &&
                exe.task.name !== task.name
        );
        if (index !== -1) {
            return;
        }

        vscode.tasks.executeTask(task);
    });
    return { dispose: () => onDidSaveDocument.dispose() };
}
