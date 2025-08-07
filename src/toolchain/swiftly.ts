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

import * as path from "path";
import { SwiftlyConfig } from "./ToolchainVersion";
import * as fs from "fs/promises";
import { execFile, ExecFileError } from "../utilities/utilities";
import * as vscode from "vscode";
import { Version } from "../utilities/version";
import { z } from "zod/v4/mini";
import { SwiftLogger } from "../logging/SwiftLogger";

const ListResult = z.object({
    toolchains: z.array(
        z.object({
            inUse: z.boolean(),
            isDefault: z.boolean(),
            version: z.discriminatedUnion("type", [
                z.object({
                    major: z.union([z.number(), z.undefined()]),
                    minor: z.union([z.number(), z.undefined()]),
                    patch: z.union([z.number(), z.undefined()]),
                    name: z.string(),
                    type: z.literal("stable"),
                }),
                z.object({
                    major: z.union([z.number(), z.undefined()]),
                    minor: z.union([z.number(), z.undefined()]),
                    branch: z.string(),
                    date: z.string(),
                    name: z.string(),
                    type: z.literal("snapshot"),
                }),
            ]),
        })
    ),
});

const InUseVersionResult = z.object({
    version: z.string(),
});

export class Swiftly {
    /**
     * Finds the version of Swiftly installed on the system.
     *
     * @returns the version of Swiftly as a `Version` object, or `undefined`
     * if Swiftly is not installed or not supported.
     */
    public static async version(logger?: SwiftLogger): Promise<Version | undefined> {
        if (!Swiftly.isSupported()) {
            return undefined;
        }
        try {
            const { stdout } = await execFile("swiftly", ["--version"]);
            return Version.fromString(stdout.trim());
        } catch (error) {
            logger?.error(`Failed to retrieve Swiftly version: ${error}`);
            return undefined;
        }
    }

    /**
     * Checks if the installed version of Swiftly supports JSON output.
     *
     * @returns `true` if JSON output is supported, `false` otherwise.
     */
    private static async supportsJsonOutput(logger?: SwiftLogger): Promise<boolean> {
        if (!Swiftly.isSupported()) {
            return false;
        }
        try {
            const { stdout } = await execFile("swiftly", ["--version"]);
            const version = Version.fromString(stdout.trim());
            return version?.isGreaterThanOrEqual(new Version(1, 1, 0)) ?? false;
        } catch (error) {
            logger?.error(`Failed to check Swiftly JSON support: ${error}`);
            return false;
        }
    }

    /**
     * Finds the list of toolchains managed by Swiftly.
     *
     * @returns an array of toolchain paths
     */
    public static async listAvailableToolchains(logger?: SwiftLogger): Promise<string[]> {
        if (!this.isSupported()) {
            return [];
        }
        const version = await Swiftly.version(logger);
        if (!version) {
            logger?.warn("Swiftly is not installed");
            return [];
        }

        if (!(await Swiftly.supportsJsonOutput(logger))) {
            return await Swiftly.getToolchainInstallLegacy(logger);
        }

        return await Swiftly.getListAvailableToolchains(logger);
    }

    private static async getListAvailableToolchains(logger?: SwiftLogger): Promise<string[]> {
        try {
            const { stdout } = await execFile("swiftly", ["list", "--format=json"]);
            const response = ListResult.parse(JSON.parse(stdout));
            return response.toolchains.map(t => t.version.name);
        } catch (error) {
            logger?.error(`Failed to retrieve Swiftly installations: ${error}`);
            return [];
        }
    }

    private static async getToolchainInstallLegacy(logger?: SwiftLogger) {
        try {
            const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
            if (!swiftlyHomeDir) {
                return [];
            }
            const swiftlyConfig = await Swiftly.getConfig();
            if (!swiftlyConfig || !("installedToolchains" in swiftlyConfig)) {
                return [];
            }
            const installedToolchains = swiftlyConfig.installedToolchains;
            if (!Array.isArray(installedToolchains)) {
                return [];
            }
            return installedToolchains
                .filter((toolchain): toolchain is string => typeof toolchain === "string")
                .map(toolchain => path.join(swiftlyHomeDir, "toolchains", toolchain));
        } catch (error) {
            logger?.error(`Failed to retrieve Swiftly installations: ${error}`);
            throw new Error(
                `Failed to retrieve Swiftly installations from disk: ${(error as Error).message}`
            );
        }
    }

    public static isSupported() {
        return process.platform === "linux" || process.platform === "darwin";
    }

    public static async inUseLocation(swiftlyPath: string = "swiftly", cwd?: vscode.Uri) {
        const { stdout: inUse } = await execFile(swiftlyPath, ["use", "--print-location"], {
            cwd: cwd?.fsPath,
        });
        return inUse.trimEnd();
    }

    public static async inUseVersion(
        swiftlyPath: string = "swiftly",
        cwd?: vscode.Uri
    ): Promise<string | undefined> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }

        if (!(await Swiftly.supportsJsonOutput())) {
            return undefined;
        }

        const { stdout } = await execFile(swiftlyPath, ["use", "--format=json"], {
            cwd: cwd?.fsPath,
        });
        const result = InUseVersionResult.parse(JSON.parse(stdout));
        return result.version;
    }

    public static async use(version: string): Promise<void> {
        if (!this.isSupported()) {
            throw new Error("Swiftly is not supported on this platform");
        }
        await execFile("swiftly", ["use", version]);
    }

    /**
     * Determine if Swiftly is being used to manage the active toolchain and if so, return
     * the path to the active toolchain.
     * @returns The location of the active toolchain if swiftly is being used to manage it.
     */
    public static async toolchain(
        logger?: SwiftLogger,
        cwd?: vscode.Uri
    ): Promise<string | undefined> {
        const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
        if (swiftlyHomeDir) {
            const { stdout: swiftLocation } = await execFile("which", ["swift"]);
            if (swiftLocation.startsWith(swiftlyHomeDir)) {
                // Print the location of the toolchain that swiftly is using. If there
                // is no cwd specified then it returns the global "inUse" toolchain otherwise
                // it respects the .swift-version file in the cwd and resolves using that.
                try {
                    const inUse = await Swiftly.inUseLocation("swiftly", cwd);
                    if (inUse.length > 0) {
                        return path.join(inUse, "usr");
                    }
                } catch (err: unknown) {
                    logger?.error(`Failed to retrieve Swiftly installations: ${err}`);
                    const error = err as ExecFileError;
                    // Its possible the toolchain in .swift-version is misconfigured or doesn't exist.
                    void vscode.window.showErrorMessage(
                        `Failed to load toolchain from Swiftly: ${error.stderr}`
                    );
                }
            }
        }
        return undefined;
    }

    /**
     * Reads the Swiftly configuration file, if it exists.
     *
     * @returns A parsed Swiftly configuration.
     */
    private static async getConfig(): Promise<SwiftlyConfig | undefined> {
        const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
        if (!swiftlyHomeDir) {
            return;
        }
        const swiftlyConfigRaw = await fs.readFile(
            path.join(swiftlyHomeDir, "config.json"),
            "utf-8"
        );
        return JSON.parse(swiftlyConfigRaw);
    }

    public static async isInstalled(): Promise<boolean> {
        if (!this.isSupported()) {
            return false;
        }
        try {
            const { stdout } = await execFile("which", ["swiftly"]);
            return stdout.trim().length > 0;
        } catch (error) {
            return false;
        }
    }
}
