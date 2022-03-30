import * as vscode from "vscode";
import { isPathInsidePath } from "./utilities/utilities";
import { createBuildAllTask } from "./SwiftTaskProvider";
import configuration from "./configuration";
import { FolderContext } from "./FolderContext";
import { WorkspaceContext } from "./WorkspaceContext";

export class BackgroundCompilation {
    private waitingToRun = false;

    constructor(private folderContext: FolderContext) {}

    runTask() {
        // create compile task and execute it
        const task = createBuildAllTask(this.folderContext);
        task.name = `${task.name} (Background)`;
        task.presentationOptions = {
            reveal: vscode.TaskRevealKind.Never,
            panel: vscode.TaskPanelKind.Dedicated,
        };

        // are there any tasks running inside this folder
        const index = vscode.tasks.taskExecutions.findIndex(
            exe => exe.task.definition.cwd === this.folderContext.folder.fsPath
        );
        if (index !== -1) {
            if (this.waitingToRun) {
                return;
            }
            this.waitingToRun = true;
            // if we found a task then wait until no tasks are running on this folder and then run
            // the build task
            const disposable = vscode.tasks.onDidEndTaskProcess(event => {
                // find running task, that is running on current folder and is not the one that
                // just ended
                const index2 = vscode.tasks.taskExecutions.findIndex(
                    exe =>
                        exe.task.definition.cwd === this.folderContext.folder.fsPath &&
                        exe !== event.execution
                );
                if (index2 === -1) {
                    disposable.dispose();
                    vscode.tasks.executeTask(task);
                    this.waitingToRun = false;
                }
            });
            return;
        }

        vscode.tasks.executeTask(task);
    }

    static start(workspaceContext: WorkspaceContext): vscode.Disposable {
        const onDidSaveDocument = vscode.workspace.onDidSaveTextDocument(event => {
            if (configuration.backgroundCompilation === false) {
                return;
            }

            // is editor document in any of the current FolderContexts
            const folderContext = workspaceContext.folders.find(context => {
                return isPathInsidePath(event.uri.fsPath, context.folder.fsPath);
            });

            // run background compilation task
            folderContext?.backgroundCompilation.runTask();
        });
        return { dispose: () => onDidSaveDocument.dispose() };
    }
}
