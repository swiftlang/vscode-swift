import * as vscode from 'vscode';
import { SwiftPackage } from './package';

export class SwiftContext {
	private constructor(
        public workspaceRoot: string,
        public extensionContext: vscode.ExtensionContext,
        public swiftPackage: SwiftPackage
    ) {}

    static async create(
        workspaceRoot: string, 
        extContext: vscode.ExtensionContext
    ): Promise<SwiftContext> 
    {
        let swiftPackage = await SwiftPackage.create(workspaceRoot);
        return new SwiftContext(workspaceRoot, extContext, swiftPackage);
    }
}

