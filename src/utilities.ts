import * as cp from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Asynchronous wrapper around {@link cp.exec child_process.exec}.
 */
export async function exec(command: string, options: cp.ExecOptions): Promise<{ stdout: string; stderr: string }> {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => 
        cp.exec(command, options, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            }
            resolve({ stdout, stderr });
        })
    );
}

/**
 * Whether the given path exists.
 * 
 * Does not check whether the user has permission to read the path.
 */
export async function pathExists(...pathComponents: string[]): Promise<boolean> {
    try {
        await fs.access(path.join(...pathComponents));
        return true;
    } catch {
        return false;
    }
}
