//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { tmpdir } from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { randomString } from "./utilities";
import { Disposable } from "vscode";

export class TemporaryFolder {
    private constructor(public path: string) {}

    public createDisposableFileCollection(): DisposableFileCollection {
        return new DisposableFileCollection(this);
    }
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
     * Generate temporary filename, run a process and delete file with filename once that
     * process has finished
     *
     * @param prefix File prefix
     * @param extension File extension
     * @param process Process to run
     * @returns return value of process
     */
    async withTemporaryFile<Return>(
        extension: string,
        process: (filename: string) => Promise<Return>
    ): Promise<Return> {
        const filename = this.filename("", extension);
        return TemporaryFolder.withNamedTemporaryFile(filename, () => process(filename));
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

    /**
     * Run a process and delete file with filename once that
     * process has finished.
     *
     * @param path Full file path to a temporary file
     * @param process Process to run
     * @returns return value of process
     */
    static async withNamedTemporaryFile<Return>(
        path: string,
        process: () => Promise<Return>
    ): Promise<Return> {
        try {
            const rt = await process();
            await fs.rm(path, { force: true });
            return rt;
        } catch (error) {
            await fs.rm(path, { force: true });
            throw error;
        }
    }
}

export class DisposableFileCollection implements Disposable {
    private files: string[] = [];

    constructor(private folder: TemporaryFolder) {}

    public file(prefix: string, extension?: string): string {
        const filename = this.folder.filename(prefix, extension);
        this.files.push(filename);
        return filename;
    }

    async dispose() {
        for (const file of this.files) {
            await fs.rm(file, { force: true });
        }
        this.files = [];
    }
}
