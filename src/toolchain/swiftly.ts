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
import { z } from "zod";

const ListResult = z.object({
    toolchains: z.array(
        z.object({
            inUse: z.boolean(),
            installed: z.boolean(),
            isDefault: z.boolean(),
            name: z.string(),
            version: z.discriminatedUnion("type", [
                z.object({
                    major: z.number().optional(),
                    minor: z.number().optional(),
                    patch: z.number().optional(),
                    name: z.string(),
                    type: z.literal("stable"),
                }),
                z.object({
                    major: z.number().optional(),
                    minor: z.number().optional(),
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
    public static async version(
        outputChannel?: vscode.OutputChannel
    ): Promise<Version | undefined> {
        if (!Swiftly.isSupported()) {
            return undefined;
        }
        try {
            const { stdout } = await execFile("swiftly", ["--version"]);
            return Version.fromString(stdout.trim());
        } catch (error) {
            outputChannel?.appendLine(`Failed to retrieve Swiftly version: ${error}`);
            return undefined;
        }
    }

    /**
     * Checks if the installed version of Swiftly supports JSON output.
     *
     * @returns `true` if JSON output is supported, `false` otherwise.
     */
    private static async supportsJsonOutput(
        outputChannel?: vscode.OutputChannel
    ): Promise<boolean> {
        if (!Swiftly.isSupported()) {
            return false;
        }
        try {
            const { stdout } = await execFile("swiftly", ["--version"]);
            const version = Version.fromString(stdout.trim());
            return version?.isGreaterThanOrEqual(new Version(1, 1, 0)) ?? false;
        } catch (error) {
            outputChannel?.appendLine(`Failed to check Swiftly JSON support: ${error}`);
            return false;
        }
    }

    /**
     * Finds the list of toolchains managed by Swiftly.
     *
     * @returns an array of toolchain paths
     */
    public static async listAvailableToolchains(
        outputChannel?: vscode.OutputChannel
    ): Promise<string[]> {
        if (!this.isSupported()) {
            return [];
        }
        const version = await Swiftly.version(outputChannel);
        if (!version) {
            outputChannel?.appendLine("Swiftly is not installed");
            return [];
        }

        if (!(await Swiftly.supportsJsonOutput(outputChannel))) {
            return await Swiftly.getToolchainInstallLegacy(outputChannel);
        }

        return await Swiftly.getListAvailableToolchains(outputChannel);
    }

    private static async getListAvailableToolchains(
        outputChannel?: vscode.OutputChannel
    ): Promise<string[]> {
        try {
            const { stdout } = await execFile("swiftly", ["list", "--format=json"]);
            const response = ListResult.parse(JSON.parse(stdout));
            return response.toolchains.map(t => t.version.name);
        } catch (error) {
            outputChannel?.appendLine(
                `Failed to retrieve Swiftly installations : ${error}`);
            return [];
        }
    }

    private static async getToolchainInstallLegacy(outputChannel?: vscode.OutputChannel) {
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
            outputChannel?.appendLine(`Failed to retrieve Swiftly installations: ${error}`);
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
        outputChannel?: vscode.OutputChannel,
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
                    outputChannel?.appendLine(`Failed to retrieve Swiftly installations: ${err}`);
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

    public static async isInstalled() {
        if (!Swiftly.isSupported()) {
            return false;
        }

        try {
            await Swiftly.version();
            return true;
        } catch (error) {
            if (error instanceof ExecFileError && "code" in error && error.code === "ENOENT") {
                return false;
            }
            throw error;
        }
    }
}
