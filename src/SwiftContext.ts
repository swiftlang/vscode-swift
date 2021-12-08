//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from 'vscode';
import { SwiftPackage } from './SwiftPackage';

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

