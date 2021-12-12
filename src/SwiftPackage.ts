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
import { exec } from './utilities';

// Swift Package Manager contents
export interface PackageContents {
    name: string
    products: Product[]
    dependencies: Dependency[]
    targets: Target[]
}

// Swift Package Manager product
export interface Product {
    name: string
    targets: string[]
    type: {executable?: null, library?: string[]}
}

// Swift Package Manager target
export interface Target {
    name: string
    path: string
    sources: string[]
    type: 'executable'|'test'|'library'
}

// Swift Package Manager dependency
export interface Dependency {
    identity: string
    requirement?: object
    url?: string
}

// Class holding Swift Package Manager Package
export class SwiftPackage implements PackageContents {
	private constructor(
        readonly folder: vscode.WorkspaceFolder,
        public contents?: PackageContents
    ) {}

    public static async create(folder: vscode.WorkspaceFolder): Promise<SwiftPackage> {
        try {
            let contents = await SwiftPackage.loadPackage(folder);
            return new SwiftPackage(folder, contents);
        } catch(error) {
            // TODO: output errors
            return new SwiftPackage(folder, undefined);
        }
    }

    public static async loadPackage(folder: vscode.WorkspaceFolder): Promise<PackageContents> {
        const { stdout } = await exec('swift package describe --type json', { cwd: folder.uri.fsPath });
        return JSON.parse(stdout);
    }

    public async reload() {
        try {
            this.contents = await SwiftPackage.loadPackage(this.folder);
        } catch {
            this.contents = undefined;
        }
    }

    get name(): string {
        return this.contents?.name ?? '';
    }

    get products(): Product[] {
        return this.contents?.products ?? [];
    }

    get dependencies(): Dependency[] {
        return this.contents?.dependencies ?? [];
    }

    get targets(): Target[] {
        return this.contents?.targets ?? [];
    }

    get executableProducts(): Product[] {
        return this.products.filter(product => product.type.executable !== undefined);
    }

    get libraryProducts(): Product[] {
        return this.products.filter(product => product.type.library !== undefined);
    }

    getTargets(type: 'executable'|'library'|'test'): Target[] {
        return this.targets.filter((target, index, array) => {
            return target.type === type;
        });    
    }
}
