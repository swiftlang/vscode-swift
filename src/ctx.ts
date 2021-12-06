import * as vscode from 'vscode';
import { SPMPackage } from './package';

export class Ctx {
	private constructor(
        public workspaceRoot: string,
        public extContext: vscode.ExtensionContext,
        public spmPackage: SPMPackage
    ) {}

    static async create(
        workspaceRoot: string, 
        extContext: vscode.ExtensionContext
    ): Promise<Ctx> 
    {
        let spmPackage = await SPMPackage.create(workspaceRoot);
        return new Ctx(workspaceRoot, extContext, spmPackage)
    }
}

