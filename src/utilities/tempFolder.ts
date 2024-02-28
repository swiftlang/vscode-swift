//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { tmpdir } from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { randomString } from "./utilities";

export class TemporaryFolder {
    private constructor(public path: string) {}

    /**
     * Return random filename inside temporary folder
     * @param prefix Prefix of file
     * @param extension File extension
     * @returns Filename
     */
    filename(prefix: string, extension?: string): string {
        let filename: string;
        if (extension) {
            filename = `${prefix}${randomString(16)}.${extension}`;
        } else {
            filename = `${prefix}${randomString(16)}`;
        }
        return path.join(this.path, filename);
    }

    /**
     * Generate temporary filename, run process and delete file with filename once that
     * process has finished
     *
     * @param prefix File prefix
     * @param extension File extension
     * @param process Process to run
     * @returns return value of process
     */
    async withTemporaryFile<Return>(
        extension: string,
        process: {
            (filename: string): Promise<Return>;
        }
    ): Promise<Return> {
        const filename = this.filename("", extension);
        try {
            const rt = await process(filename);
            await fs.rm(filename, { force: true });
            return rt;
        } catch (error) {
            await fs.rm(filename, { force: true });
            throw error;
        }
    }

    /**
     * Create Temporary folder
     * @returns Temporary folder class
     */
    static async create(): Promise<TemporaryFolder> {
        const tmpPath = path.join(tmpdir(), "vscode-swift");
        try {
            await fs.mkdir(tmpPath);
        } catch {
            // ignore error. It is most likely directory exists already
        }
        return new TemporaryFolder(tmpPath);
    }
}
