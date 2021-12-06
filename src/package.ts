import { privateEncrypt } from 'crypto';
import contextKeys from './contextKeys';
import { exec, pathExists } from './utilities';

export class SPMPackage {
	private constructor(
        readonly folder: string,
        public contents: any
    ) {
        this.setContextKeys()
    }

    public static async create(folder: string): Promise<SPMPackage> {
        try {
            let contents = await SPMPackage.loadPackage(folder)
            return new SPMPackage(folder, contents)
        } catch(error) {
            // TODO: output errors
            return new SPMPackage(folder, null)
        }
    }

    public static async loadPackage(folder: string): Promise<any> {
        const { stdout } = await exec('swift package describe --type json', { cwd: folder });
        return JSON.parse(stdout)
    }

    public async reload() {
        try {
            this.contents = await SPMPackage.loadPackage(this.folder)
        } catch {
            
        }
        this.setContextKeys()
    }

    get products(): Array<any> {
        return this.contents.products
    }

    get dependencies(): Array<any> {
        return this.contents.dependencies
    }

    get targets(): Array<any> {
        return this.contents.targets
    }

    private setContextKeys() {
        if (this.contents == null) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        }
        contextKeys.packageHasDependencies = this.contents.dependencies.length > 0;       
    }
}
