import * as vscode from 'vscode';

/**
 * References:
 * 
 * - Contributing commands:
 *   https://code.visualstudio.com/api/references/contribution-points#contributes.commands
 * - Implementing commands:
 *   https://code.visualstudio.com/api/extension-guides/command
 */

/**
 * Contains the commands defined in this extension.
 */
const commands = {

    /**
     * Executes a {@link vscode.Task task} to resolve this package's dependencies.
     */
    async resolveDependencies() {
        let tasks = await vscode.tasks.fetchTasks();
        let task = tasks.find(task =>
            task.definition.command === 'swift' &&
            task.definition.args[0] === 'package' &&
            task.definition.args[1] === 'resolve'
        )!;
        vscode.tasks.executeTask(task);
    },

    /**
     * Registers this extension's commands in the given {@link vscode.ExtensionContext context}.
     */
    register(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.commands.registerCommand('swift.resolveDependencies', this.resolveDependencies)
        );
    }
};

export default commands;
