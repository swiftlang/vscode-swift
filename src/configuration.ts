import * as vscode from 'vscode';

/**
 * Type-safe wrapper around configuration settings.
 */
const configuration = {

    /**
     * Files and directories to exclude from the Package Dependencies view.
     */
    get excludePathsFromPackageDependencies(): string[] {
        return vscode.workspace.getConfiguration('swift').get<string[]>('excludePathsFromPackageDependencies') ?? [];
    },
    set excludePathsFromPackageDependencies(value: string[]) {
        vscode.workspace.getConfiguration('swift').update('excludePathsFromPackageDependencies', value);
    }
};

export default configuration;
