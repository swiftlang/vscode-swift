//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as os from "os";

import configuration from "../configuration";

export interface Environment {
    platform: NodeJS.Platform;

    env(): NodeJS.ProcessEnv;

    cwd(): string;

    homedir(): string;

    getExecutablePath(exe?: string): string;

    /** Return environment variable to update for runtime library search path */
    swiftLibraryPathKey(): string;

    /**
     * Get required environment variable for Swift product
     *
     * @param base base environment configuration
     * @returns minimal required environment for Swift product
     */
    swiftRuntimeEnv(
        base?: NodeJS.ProcessEnv | boolean,
        runtimePath?: string
    ): { [key: string]: string } | undefined;
}

export class NodeEnvironment implements Environment {
    platform: NodeJS.Platform;

    constructor(private readonly config: typeof configuration) {
        this.platform = process.platform;
    }

    env(): NodeJS.ProcessEnv {
        return process.env;
    }

    cwd(): string {
        return process.cwd();
    }

    homedir(): string {
        return os.homedir();
    }

    getExecutablePath(exe: string): string {
        // should we add `.exe` at the end of the executable name
        const windowsExeSuffix = this.platform === "win32" ? ".exe" : "";
        return `${exe}${windowsExeSuffix}`;
    }

    swiftLibraryPathKey(): string {
        switch (this.platform) {
            case "win32":
                return "Path";
            case "darwin":
                return "DYLD_LIBRARY_PATH";
            default:
                return "LD_LIBRARY_PATH";
        }
    }

    swiftRuntimeEnv(
        base: NodeJS.ProcessEnv | boolean = process.env,
        runtimePath: string = this.config.runtimePath
    ): { [key: string]: string } | undefined {
        const key = this.swiftLibraryPathKey();
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
        return this.runtimeEnv(base, key, runtimePath, separator);
    }

    private runtimeEnv(
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
}
