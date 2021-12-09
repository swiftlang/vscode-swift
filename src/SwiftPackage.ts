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

// package we attempted to load but failed
class NullPackage implements PackageContents {
    get name(): string { return ""; }
    get products(): Product[] { return []; }
    get dependencies(): Dependency[] { return []; }
    get targets(): Target[] { return []; }
}

// Class holding Swift Package Manager Package
export class SwiftPackage implements PackageContents {
	private constructor(
        readonly folder: string,
        public contents: PackageContents|null
    ) {
        this.setContextKeys();
    }

    public static async create(folder: string): Promise<SwiftPackage> {
        let contents = await SwiftPackage.loadPackage(folder);
        return new SwiftPackage(folder, contents);
    }

    public static async loadPackage(folder: string): Promise<PackageContents|null> {
        try {
            const { stdout } = await exec('swift package describe --type json', { cwd: folder });
            return JSON.parse(stdout);
        } catch(error) {
            const execError = error as {stderr: string};
            // if caught error and it begins with "error: root manifest" then there is no Package.swift
            if (execError.stderr.startsWith("error: root manifest")) {
                return null;
            } else {
                // otherwise it is an error loading the Package.swift so return a `NullPackage` indicating
                // we have a package but we failed to load it
                return new NullPackage();
            }
        }
    }

    public async reload() {
        this.contents = await SwiftPackage.loadPackage(this.folder);
        this.setContextKeys();
    }

    public foundPackage(): boolean {
        return this.contents !== null;
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

    private setContextKeys() {
        if (this.contents === null) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        }
        contextKeys.hasPackage = true;
        contextKeys.packageHasDependencies = this.dependencies.length > 0;  
    }
}
