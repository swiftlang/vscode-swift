import * as fs from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";

type Export<T, K extends keyof T> = { [P in K]: T[K] };

export type FileSystem = typeof fsPromises &
    CustomFileSystemMethods &
    Export<typeof fs, "createReadStream">;

interface CustomFileSystemMethods {
    /**
     * Generate temporary filename, run a process and delete file with filename once that
     * process has finished.
     *
     * @param prefix File prefix
     * @param process Process to run
     * @returns return value of process
     */
    withTemporaryDirectory<T>(
        prefix: string,
        process: (directory: string) => Promise<T>
    ): Promise<T>;

    /**
     * Checks if a file, directory or symlink exists at the supplied path.
     * @param pathComponents The path to check for existence
     * @returns Whether or not an entity exists at the path
     */
    pathExists(...pathComponents: string[]): Promise<boolean>;

    /**
     * Checks if a file exists at the supplied path.
     * @param pathComponents The file path to check for existence
     * @returns Whether or not the file exists at the path
     */
    fileExists(...pathComponents: string[]): Promise<boolean>;
}

export function createNodeFS(): FileSystem {
    return {
        async withTemporaryDirectory<T>(
            prefix: string,
            body: (directory: string) => Promise<T>
        ): Promise<T> {
            const directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), prefix));
            try {
                return await body(directory);
            } finally {
                fsPromises
                    .rm(directory, { force: true, recursive: true })
                    // Ignore any errors that arise as a result of removing the directory
                    .catch(() => {});
            }
        },
        async pathExists(...pathComponents: string[]): Promise<boolean> {
            try {
                await fsPromises.access(path.join(...pathComponents));
                return true;
            } catch {
                return false;
            }
        },
        async fileExists(...pathComponents: string[]): Promise<boolean> {
            try {
                return (await fsPromises.stat(path.join(...pathComponents))).isFile();
            } catch (e) {
                return false;
            }
        },
        createReadStream: fs.createReadStream,
        ...fsPromises,
    };
}
