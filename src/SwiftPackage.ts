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

import contextKeys from './contextKeys';
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
    type: 'library'|'executable'
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
    url?: string
    path?: string
}

// Class holding Swift Package Manager Package
export class SwiftPackage implements PackageContents {
	private constructor(
        readonly folder: string,
        public contents?: PackageContents
    ) {
        this.setContextKeys();
    }

    public static async create(folder: string): Promise<SwiftPackage> {
        try {
            let contents = await SwiftPackage.loadPackage(folder);
            return new SwiftPackage(folder, contents);
        } catch(error) {
            // TODO: output errors
            return new SwiftPackage(folder, undefined);
        }
    }

    public static async loadPackage(folder: string): Promise<PackageContents> {
        const { stdout } = await exec('swift package describe --type json', { cwd: folder });
        return JSON.parse(stdout);
    }

    public async reload() {
        try {
            this.contents = await SwiftPackage.loadPackage(this.folder);
        } catch {
            this.contents = undefined;
        }
        this.setContextKeys();
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

    getTargets(type: 'executable'|'library'|'test'): Target[] {
        return this.targets.filter((target, index, array) => {
            return target.type === type;
        });    
    }

    private setContextKeys() {
        if (this.contents === undefined) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        }
        contextKeys.hasPackage = true;
        contextKeys.packageHasDependencies = this.dependencies.length > 0;  
    }
}
