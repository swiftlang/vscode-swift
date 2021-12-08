import { privateEncrypt } from 'crypto';
import contextKeys from './contextKeys';
import { exec, pathExists } from './utilities';

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

    private setContextKeys() {
        if (this.contents === undefined) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        }
        contextKeys.hasPackage = true;
        contextKeys.packageHasDependencies = this.dependencies.length > 0;  
    }
}
