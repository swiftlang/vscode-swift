import * as vscode from 'vscode';

/**
 * References:
 * 
 * - `when` clause contexts:
 *   https://code.visualstudio.com/api/references/when-clause-contexts
 */

/**
 * Type-safe wrapper around context keys used in `when` clauses.
 */
const contextKeys = {

    /**
     * Whether the workspace folder contains a Swift package.
     */
    set hasPackage(value: boolean) {
        vscode.commands.executeCommand('setContext', 'swift.hasPackage', value);
    },

    /**
     * Whether the Swift package has any dependencies to display in the Package Dependencies view.
     */
    set packageHasDependencies(value: boolean) {
        vscode.commands.executeCommand('setContext', 'swift.packageHasDependencies', value);
    }
};

export default contextKeys;