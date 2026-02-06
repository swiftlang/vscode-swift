import * as child_process from "child_process";
import { promisify } from "util";

const exec = promisify(child_process.exec);

export async function swiftInstalled(): Promise<boolean> {
    try {
        await exec("swift --version");
        return true;
    } catch (error) {
        return false;
    }
}
