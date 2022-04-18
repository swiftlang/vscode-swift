//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import * as Stream from "stream";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";

/**
 * Get required environment variable for Swift runtime
 *
 * @param env base environment
 * @returns minimal required environment for Swift runtime
 */
export function swiftRuntimePathEnv(
    env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv | undefined {
    if (configuration.runtimePath === "") {
        return undefined;
    }
    const runtimePath = configuration.runtimePath;
    switch (process.platform) {
        case "win32":
            return { Path: `${runtimePath};${env.Path}` };
        case "darwin":
            return { DYLD_LIBRARY_PATH: `${runtimePath}:${env.DYLD_LIBRARY_PATH}` };
        default:
            return { LD_LIBRARY_PATH: `${runtimePath}:${env.LD_LIBRARY_PATH}` };
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
    folderContext?: FolderContext
): Promise<{ stdout: string; stderr: string }> {
    folderContext?.workspaceContext.outputChannel.logDiagnostic(
        `Exec: ${executable} ${args.join(" ")}`,
        folderContext.name
    );
    if (configuration.runtimePath.length > 0) {
        options.env = { ...options.env, ...swiftRuntimePathEnv(options.env) };
    }
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) =>
        cp.execFile(executable, args, options, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            }
            resolve({ stdout, stderr });
        })
    );
}

export async function execFileStreamOutput(
    executable: string,
    args: string[],
    stdout: Stream.Writable | null,
    stderr: Stream.Writable | null,
    token: vscode.CancellationToken | null,
    options: cp.ExecFileOptions = {},
    folderContext?: FolderContext
): Promise<{ stdout: string; stderr: string }> {
    folderContext?.workspaceContext.outputChannel.logDiagnostic(
        `Exec: ${executable} ${args.join(" ")}`,
        folderContext.name
    );
    if (configuration.runtimePath.length > 0) {
        options.env = { ...options.env, ...swiftRuntimePathEnv(options.env) };
    }
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const p = cp.execFile(executable, args, options, (error, stdout, stderr) => {
            if (error) {
                reject({ error, stdout, stderr });
            }
            resolve({ stdout, stderr });
        });
        if (stdout) {
            p.stdout?.pipe(stdout);
        }
        if (stderr) {
            p.stderr?.pipe(stderr);
        }
        if (token) {
            const cancellation = token.onCancellationRequested(() => {
                p.kill();
                cancellation.dispose();
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
    options: cp.ExecFileOptions = {},
    setSDKFlags = false,
    folderContext?: FolderContext
): Promise<{ stdout: string; stderr: string }> {
    const swift = getSwiftExecutable();
    if (setSDKFlags) {
        args = withSwiftSDKFlags(args);
    }
    return await execFile(swift, args, options, folderContext);
}

/**
 * Get modified swift arguments with SDK flags.
 *
 * @param args original commandline arguments
 */
export function withSwiftSDKFlags(args: string[]): string[] {
    switch (args.length > 0 ? args[0] : null) {
        case "package": {
            // swift-package requires SDK flags to be placed before subcommand options
            // eg. ["package", "describe", "--type", "json"] should be turned into
            // ["package", "describe", "--sdk", "/path/to/sdk", "--type", "json"]
            if (args.length <= 2) {
                return args.concat(swiftpmSDKFlags());
            }
            const subcommand = args.splice(0, 2);
            return [...subcommand, ...swiftpmSDKFlags(), ...args];
        }
        case "build":
        case "run":
        case "test":
            return args.concat(swiftpmSDKFlags());
        default:
            return args.concat(swiftDriverSDKFlags());
    }
}

/**
 * Get SDK flags for SwiftPM
 */
export function swiftpmSDKFlags(): string[] {
    if (configuration.sdk !== "") {
        return ["--sdk", configuration.sdk];
    }
    return [];
}

/**
 * Get SDK flags for swiftc
 *
 * @param indirect whether to pass the flags by -Xswiftc
 */
export function swiftDriverSDKFlags(indirect = false): string[] {
    if (configuration.sdk !== "") {
        return [];
    }
    const args = ["-sdk", configuration.sdk];
    return indirect ? args.flatMap(arg => ["-Xswiftc", arg]) : args;
}

/**
 * Get the file name of executable
 *
 * @param exe name of executable to return
 */
export function getExecutableName(exe: string): string {
    return process.platform === "win32" ? `${exe}.exe` : exe;
}

/**
 * Get path to swift executable, or executable in swift bin folder
 *
 * @param exe name of executable to return
 */
export function getSwiftExecutable(exe = "swift"): string {
    return path.join(configuration.path, getExecutableName(exe));
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

/**
 * Return whether a file is inside a folder
 * @param subfolder child file/folder
 * @param folder parent folder
 * @returns if child file is inside parent folder
 */
export function isPathInsidePath(subfolder: string, folder: string): boolean {
    const relativePath = path.relative(folder, subfolder);
    // return true if path doesnt start with '..'
    return relativePath[0] !== "." || relativePath[1] !== ".";
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
    const stdError = error as { stderr: string };
    if (stdError) {
        return stdError.stderr;
    } else if (error instanceof Error) {
        return error.toString();
    } else {
        return JSON.stringify(error);
    }
}
