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

import * as path from "node:path";
import { SwiftlyConfig } from "./ToolchainVersion";
import * as fs from "node:fs/promises";
import { execFile, ExecFileError } from "../utilities/utilities";
import * as vscode from "vscode";
import { Version } from "../utilities/version";
import { z } from "zod";

const ListAvailableResult = z.object({
    toolchains: z.array(
        z.object({
            inUse: z.boolean(),
            installed: z.boolean(),
            isDefault: z.boolean(),
            name: z.string(),
            version: z.discriminatedUnion("type", [
                z.object({
                    major: z.number(),
                    minor: z.number(),
                    patch: z.number().optional(),
                    type: z.literal("stable"),
                }),
                z.object({
                    major: z.number(),
                    minor: z.number(),
                    branch: z.string(),
                    date: z.string(),

                    type: z.literal("snapshot"),
                }),
            ]),
        })
    ),
});

export class Swiftly {
    /**
     * Finds the version of Swiftly installed on the system.
     *
     * @returns the version of Swiftly as a `Version` object, or `undefined`
     * if Swiftly is not installed or not supported.
     */
    public async getSwiftlyVersion(): Promise<Version | undefined> {
        if (!this.isSupported()) {
            return undefined;
        }
        const { stdout } = await execFile("swiftly", ["--version"]);
        return Version.fromString(stdout.trim());
    }

    /**
     * Finds the list of toolchains managed by Swiftly.
     *
     * @returns an array of toolchain paths
     */
    public async getSwiftlyToolchainInstalls(): Promise<string[]> {
        if (!this.isSupported()) {
            return [];
        }
        const version = await swiftly.getSwiftlyVersion();
        if (version?.isLessThan(new Version(1, 1, 0))) {
            return await this.getToolchainInstallLegacy();
        }

        return await this.getListAvailableToolchains();
    }

    private async getListAvailableToolchains(): Promise<string[]> {
        try {
            const { stdout } = await execFile("swiftly", ["list-available", "--format=json"]);
            const response = ListAvailableResult.parse(JSON.parse(stdout));
            return response.toolchains.map(t => t.name);
        } catch (error) {
            throw new Error("Failed to retrieve Swiftly installations from disk: ${error.message}");
        }
    }

    private async getToolchainInstallLegacy() {
        try {
            const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
            if (!swiftlyHomeDir) {
                return [];
            }
            const swiftlyConfig = await swiftly.getSwiftlyConfig();
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
            throw new Error("Failed to retrieve Swiftly installations from disk: ${error.message}");
        }
    }

    private isSupported() {
        return process.platform === "linux" || process.platform === "darwin";
    }

    public async swiftlyInUseLocation(swiftlyPath: string, cwd?: vscode.Uri) {
        const { stdout: inUse } = await execFile(swiftlyPath, ["use", "--print-location"], {
            cwd: cwd?.fsPath,
        });
        return inUse.trimEnd();
    }

    /**
     * Determine if Swiftly is being used to manage the active toolchain and if so, return
     * the path to the active toolchain.
     * @returns The location of the active toolchain if swiftly is being used to manage it.
     */
    public async swiftlyToolchain(cwd?: vscode.Uri): Promise<string | undefined> {
        const swiftlyHomeDir: string | undefined = process.env["SWIFTLY_HOME_DIR"];
        if (swiftlyHomeDir) {
            const { stdout: swiftLocation } = await execFile("which", ["swift"]);
            if (swiftLocation.startsWith(swiftlyHomeDir)) {
                // Print the location of the toolchain that swiftly is using. If there
                // is no cwd specified then it returns the global "inUse" toolchain otherwise
                // it respects the .swift-version file in the cwd and resolves using that.
                try {
                    const inUse = await swiftly.swiftlyInUseLocation("swiftly", cwd);
                    if (inUse.length > 0) {
                        return path.join(inUse, "usr");
                    }
                } catch (err: unknown) {
                    const error = err as ExecFileError;
                    // Its possible the toolchain in .swift-version is misconfigured or doesn't exist.
                    void vscode.window.showErrorMessage(`Failed to load toolchain from Swiftly: ${error.stderr}`);
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
    private async getSwiftlyConfig(): Promise<SwiftlyConfig | undefined> {
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
}

export const swiftly = new Swiftly();
