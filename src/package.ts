import { privateEncrypt } from 'crypto';
import contextKeys from './contextKeys';
import { exec, pathExists } from './utilities';

export class SPMPackage {
	public folder: string
	public contents: any;
	
	public constructor(folder: string) {
		this.folder = folder
		this.contents = {}
	}

	public async loadPackage() {
        // Check if Package.swift exists
        if (!await pathExists(this.folder, 'Package.swift')) {
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        }

        try {
            const { stdout } = await exec('swift package describe --type json', { cwd: this.folder });
            this.contents = JSON.parse(stdout)

            contextKeys.hasPackage = true;
            contextKeys.packageHasDependencies = this.contents.dependencies.length > 0;
        } catch(error) {
            console.log(error)
            contextKeys.hasPackage = false;
            contextKeys.packageHasDependencies = false;
        }
    }

    public hasDependencies(): boolean {
        return this.contents.dependencies?.length > 0
    }
}
