import * as vscode from "vscode";
import { Location, Range } from "vscode-languageclient";

import { WorkspaceContext } from "../WorkspaceContext";
import { createSwiftTask } from "../tasks/SwiftTaskProvider";
import { packageName } from "../utilities/tasks";

export interface PlaygroundItem {
    id: string;
    label?: string;
}

export interface DocumentPlaygroundItem extends PlaygroundItem {
    id: string;
    label?: string;
    range: Range;
}

export interface WorkspacePlaygroundItem extends PlaygroundItem {
    id: string;
    label?: string;
    location: Location;
}

/**
 * Executes a {@link vscode.Task task} to run swift playground.
 */
export async function runPlayground(ctx: WorkspaceContext, item?: PlaygroundItem) {
    const folderContext = ctx.currentFolder;
    if (!folderContext || !item) {
        return false;
    }
    const id = item.label ?? item.id;
    const task = createSwiftTask(
        ["play", id],
        `Play "${id}"`,
        {
            cwd: folderContext.folder,
            scope: folderContext.workspaceFolder,
            packageName: packageName(folderContext),
            presentationOptions: { reveal: vscode.TaskRevealKind.Always },
        },
        folderContext.toolchain
    );

    await vscode.tasks.executeTask(task);
    return true;
}
