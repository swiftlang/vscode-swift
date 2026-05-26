//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */

// This file was adapted from https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/archiver/index.d.ts

declare module "archiver" {
    import stream = require("stream");

    class ZipArchive implements Archiver {
        constructor(options?: ZipOptions);
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface ZipArchive extends Archiver {}

    class TarArchive implements Archiver {
        constructor(options?: TarOptions);
    }

    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface TarArchive extends Archiver {}

    interface EntryData {
        /** Sets the entry name including internal path */
        name: string;
        /** Sets the entry date */
        date?: Date | string;
        /** Sets the entry permissions */
        mode?: number;
        /**
         * Sets a path prefix for the entry name.
         * Useful when working with methods like `directory` or `glob`
         */
        prefix?: string;
        /**
         * Sets the fs stat data for this entry allowing
         * for reduction of fs stat calls when stat data is already known
         */
        stats?: fs.Stats;
    }

    interface ZipEntryData extends EntryData {
        /** Sets the compression method to STORE */
        store?: boolean;
    }

    type TarEntryData = EntryData;

    interface ProgressData {
        entries: {
            total: number;
            processed: number;
        };
        fs: {
            totalBytes: number;
            processedBytes: number;
        };
    }

    /** A function that lets you either opt out of including an entry (by returning false), or modify the contents of an entry as it is added (by returning an EntryData) */
    type EntryDataFunction = (entry: EntryData) => false | EntryData;

    class ArchiverError extends Error {
        code: string; // Since archiver format support is modular, we cannot enumerate all possible error codes, as the modules can throw arbitrary ones.
        data: any;
        path?: any;

        constructor(code: string, data: any);
    }

    interface Archiver extends stream.Transform {
        abort(): this;
        append(
            source: stream.Readable | Buffer | string,
            data?: EntryData | ZipEntryData | TarEntryData
        ): this;

        /** if false is passed for destpath, the path of a chunk of data in the archive is set to the root */
        directory(
            dirpath: string,
            destpath: false | string,
            data?: Partial<EntryData> | EntryDataFunction
        ): this;
        file(filename: string, data: EntryData): this;
        glob(pattern: string, options?: GlobOptions, data?: Partial<EntryData>): this;
        finalize(): Promise<void>;

        setFormat(format: string): this;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        setModule(module: Function): this;

        pointer(): number;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        use(plugin: Function): this;

        symlink(filepath: string, target: string, mode?: number): this;

        on(event: "error" | "warning", listener: (error: ArchiverError) => void): this;
        on(event: "data", listener: (data: Buffer) => void): this;
        on(event: "progress", listener: (progress: ProgressData) => void): this;
        on(event: "close" | "drain" | "finish", listener: () => void): this;
        on(event: "pipe" | "unpipe", listener: (src: stream.Readable) => void): this;
        on(event: "entry", listener: (entry: EntryData) => void): this;
        on(event: string, listener: (...args: any[]) => void): this;
    }

    type ArchiverOptions = CoreOptions & TransformOptions & ZipOptions & TarOptions;

    interface CoreOptions {
        statConcurrency?: number;
    }

    interface TransformOptions {
        allowHalfOpen?: boolean;
        readableObjectMode?: boolean;
        writeableObjectMode?: boolean;
        decodeStrings?: boolean;
        encoding?: string;
        highWaterMark?: number;
        objectmode?: boolean;
    }

    interface ZipOptions {
        comment?: string;
        forceLocalTime?: boolean;
        forceZip64?: boolean;
        /** @default false */
        namePrependSlash?: boolean;
        store?: boolean;
        zlib?: ZlibOptions;
    }

    interface TarOptions {
        gzip?: boolean;
        gzipOptions?: ZlibOptions;
    }
}
