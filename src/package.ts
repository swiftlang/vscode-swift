import { exec } from './utilities';

export class Package {
	public folder: string
	public contents: any;
	
	public constructor(folder: string) {
		this.folder = folder
		this.contents = {}
	}

	public async loadPackage() {
		const { stdout } = await exec('swift package describe --type json', { cwd: this.folder });
        this.contents = JSON.parse(stdout)	
	}
}
