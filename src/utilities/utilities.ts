//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import * as Stream from "stream";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { SwiftToolchain } from "../toolchain/toolchain";

/**
 * Get required environment variable for Swift product
 *
 * @param base base environment configuration
 * @returns minimal required environment for Swift product
 */
export function swiftRuntimeEnv(
    base: NodeJS.ProcessEnv | boolean = process.env,
    runtimePath: string = configuration.runtimePath
): { [key: string]: string } | undefined {
    const key = swiftLibraryPathKey();
    const separator = process.platform === "win32" ? ";" : ":";
    switch (base) {
        case false:
            base = {};
            break;
        case true:
            base = { [key]: `\${env:${key}}` };
            break;
        default:
            break;
    }
    return runtimeEnv(base, key, runtimePath, separator);
}

export function runtimeEnv(
    base: NodeJS.ProcessEnv,
    key: string,
    value: string,
    separator: string
): { [key: string]: string } | undefined {
    if (value === "") {
        return undefined;
    }
    return base[key] ? { [key]: `${value}${separator}${base[key]}` } : { [key]: value };
}

/** Return environment variable to update for runtime library search path */
export function swiftLibraryPathKey(): string {
    return swiftPlatformLibraryPathKey(process.platform);
}

export function swiftPlatformLibraryPathKey(platform: NodeJS.Platform): string {
    switch (platform) {
        case "win32":
            return "Path";
        case "darwin":
            return "DYLD_LIBRARY_PATH";
        default:
            return "LD_LIBRARY_PATH";
    }
}

export class ExecFileError extends Error {
    constructor(
        public readonly causedBy: Error,
        public readonly stdout: string,
        public readonly stderr: string
    ) {
        super(causedBy.message);
    }
}

/**
 * Asynchronous wrapper around {@link cp.execFile child_process.execFile}.
 *
 * Assumes output will be a string
 *
 * @param executable name of executable to run
 * @param args arguments to be passed to executable
 * @param options execution options
 */
export async function execFile(
    executable: string,
    args: string[],
    options: cp.ExecFileOptions = {},
    folderContext?: FolderContext,
    customSwiftRuntime = true
): Promise<{ stdout: string; stderr: string }> {
    folderContext?.workspaceContext.outputChannel.logDiagnostic(
        `Exec: ${executable} ${args.join(" ")}`,
        folderContext.name
    );
    if (customSwiftRuntime) {
        const runtimeEnv = swiftRuntimeEnv(options.env);
        if (runtimeEnv && Object.keys(runtimeEnv).length > 0) {
            options.env = { ...(options.env ?? process.env), ...runtimeEnv };
        }
    }
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        console.log(">>> execFile Spawn:", executable, args.join(" "), options);
        cp.execFile(executable, args, options, (error, stdout, stderr) => {
            if (error) {
                reject(new ExecFileError(error, stdout, stderr));
            }
            resolve({ stdout, stderr });
        });
    });
}

export async function execFileStreamOutput(
    executable: string,
    args: string[],
    stdout: Stream.Writable | null,
    stderr: Stream.Writable | null,
    token: vscode.CancellationToken | null,
    options: cp.ExecFileOptions = {},
    folderContext?: FolderContext,
    customSwiftRuntime = true,
    killSignal: NodeJS.Signals = "SIGTERM"
): Promise<void> {
    folderContext?.workspaceContext.outputChannel.logDiagnostic(
        `Exec: ${executable} ${args.join(" ")}`,
        folderContext.name
    );
    if (customSwiftRuntime) {
        const runtimeEnv = swiftRuntimeEnv(options.env);
        if (runtimeEnv && Object.keys(runtimeEnv).length > 0) {
            options.env = { ...(options.env ?? process.env), ...runtimeEnv };
        }
    }
    return new Promise<void>((resolve, reject) => {
        let cancellation: vscode.Disposable;
        const p = cp.execFile(executable, args, options, error => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
            if (cancellation) {
                cancellation.dispose();
            }
        });
        if (stdout) {
            p.stdout?.pipe(stdout);
        }
        if (stderr) {
            p.stderr?.pipe(stderr);
        }
        if (token) {
            cancellation = token.onCancellationRequested(() => {
                p.kill(killSignal);
            });
        }
    });
}

/**
 * Asynchronous wrapper around {@link cp.execFile child_process.execFile} running
 * swift executable
 *
 * @param args array of arguments to pass to swift executable
 * @param options execution options
 * @param setSDKFlags whether to set SDK flags
 */
export async function execSwift(
    args: string[],
    toolchain: SwiftToolchain | "default",
    options: cp.ExecFileOptions = {},
    folderContext?: FolderContext
): Promise<{ stdout: string; stderr: string }> {
    let swift: string;
    if (toolchain === "default") {
        swift = getSwiftExecutable();
    } else {
        swift = toolchain.getToolchainExecutable("swift");
    }
    if (toolchain !== "default") {
        args = toolchain.buildFlags.withAdditionalFlags(args);
    }
    if (Object.keys(configuration.swiftEnvironmentVariables).length > 0) {
        // when adding environment vars we either combine with vars passed
        // into the function or the process environment vars
        options.env = {
            ...(options.env ?? process.env),
            ...configuration.swiftEnvironmentVariables,
        };
    }
    return await execFile(swift, args, options, folderContext);
}

/**
 * Keep calling a function until it returns true
 * @param fn function to test
 * @param everyMilliseconds Time period between each call of the function
 */
export async function poll(fn: () => boolean, everyMilliseconds: number) {
    while (!fn()) {
        await wait(everyMilliseconds);
    }
}

/**
 * Wait for amount of time
 * @param milliseconds Amount of time to wait
 */
export function wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/**
 * Returns an array containing the non-null and non-undefined results of calling
 * the given transformation with each element of this sequence.
 *
 * @param arr An array to map
 * @param transform A transformation function to apply to each element
 * @returns An array containing the non-null and non-undefined results of calling transform on each element
 */
export function compactMap<T, U>(
    arr: readonly T[],
    transform: (value: T) => U | null | undefined
): U[] {
    return arr.reduce<U[]>((acc, item) => {
        const result = transform(item);
        if (result !== null && result !== undefined) {
            acc.push(result);
        }
        return acc;
    }, []);
}
/**
 * Get path to swift executable, or executable in swift bin folder
 *
 * @param exe name of executable to return
 */
export function getSwiftExecutable(exe = "swift"): string {
    // should we add `.exe` at the end of the executable name
    const windowsExeSuffix = process.platform === "win32" ? ".exe" : "";
    return path.join(configuration.path, `${exe}${windowsExeSuffix}`);
}

/**
 * Extracts the base name of a repository from its URL.
 *
 * The base name is the last path component of the URL, without the extension `.git`,
 * and without an optional trailing slash.
 */
export function getRepositoryName(url: string): string {
    // This regular expression consists of:
    // - any number of characters that aren't a slash: ([^/]*)
    // - optionally followed by a trailing slash: \/?
    // - at the end of the URL: $
    const pattern = /([^/]*)\/?$/;
    // The capture group in this pattern will match the last path component of the URL.
    let lastPathComponent = url.match(pattern)![1];
    // Trim the optional .git extension.
    if (lastPathComponent.endsWith(".git")) {
        lastPathComponent = lastPathComponent.replace(/\.git$/, "");
    }
    return lastPathComponent;
}

/**
 * Return random string
 * @param length Length of string to return (max 16)
 * @returns Random string
 */
export function randomString(length = 8): string {
    return Math.random().toString(16).substring(2, length);
}

/**
 * Return string description of Error object
 * @param error Error object
 * @returns String description of error
 */
export function getErrorDescription(error: unknown): string {
    if (!error) {
        return "No error provided";
    } else if ((error as { stderr: string }).stderr) {
        return (error as { stderr: string }).stderr;
    } else if ((error as { error: string }).error) {
        return JSON.stringify((error as { error: string }).error);
    } else if (error instanceof Error) {
        return error.message;
    } else {
        return JSON.stringify(error);
    }
}

/**
 * Convert array of strings into phrase eg "a, b and c"
 * @param strings Array of strings
 * @returns phrase
 */
export function stringArrayInEnglish(strings: string[]): string {
    return strings.length === 1
        ? strings[0]
        : [strings.slice(0, -1).join(", "), strings[strings.length - 1]].join(" and ");
}

/**
 * String hashing function taken from https://stackoverflow.com/a/52171480/7831758
 * @param str String to hash
 * @param seed Seed for hash function
 * @returns Hash of string
 */
export function hashString(str: string, seed = 0) {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Transforms a file, line and optional column in to a vscode.Location.
 * The line numbers are expected to start at 1, not 0.
 * @param string A file path
 * @param line A line number, starting at 1
 * @param column An optional column
 */
export function sourceLocationToVSCodeLocation(
    file: string,
    line: number,
    column?: number
): vscode.Location {
    return new vscode.Location(vscode.Uri.file(file), new vscode.Position(line - 1, column ?? 0));
}

const regexEscapedCharacters = new Set(["(", ")", "[", "]", ".", "$", "^", "?", "|", "/", ":"]);
/**
 * Escapes regular expression special characters with a backslash.
 * @param string A string to escape
 * @returns The escaped string
 */
export function regexEscapedString(string: string, omitting?: Set<string>): string {
    let result = "";
    for (const c of string) {
        if (regexEscapedCharacters.has(c) && (!omitting || !omitting.has(c))) {
            result += `\\${c}`;
        } else {
            result += c;
        }
    }
    return result;
}
