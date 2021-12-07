import * as vscode from 'vscode';
import { SwiftPackage } from './package';

export class SwiftContext {
	private constructor(
        public workspaceRoot: string,
        public extContext: vscode.ExtensionContext,
        public spmPackage: SwiftPackage
    ) {}

    static async create(
        workspaceRoot: string, 
        extContext: vscode.ExtensionContext
    ): Promise<SwiftContext> 
    {
        let spmPackage = await SwiftPackage.create(workspaceRoot);
        return new SwiftContext(workspaceRoot, extContext, spmPackage);
    }
}

