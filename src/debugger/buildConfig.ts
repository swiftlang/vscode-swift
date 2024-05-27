//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { BuildFlags } from "../toolchain/BuildFlags";
import { regexEscapedString, swiftRuntimeEnv } from "../utilities/utilities";
import { DebugAdapter } from "./debugAdapter";
import { TargetType } from "../SwiftPackage";
import { Version } from "../utilities/version";
import { TestKind, TestLibrary } from "../TestExplorer/TestRunner";

/**
 * Creates `vscode.DebugConfiguration`s for different combinations of
 * testing library, test kind and platform. Use the static `swiftTestingConfig`
 * and `xcTestConfig` functions to create
 */
export class DebugConfigurationFactory {
    public static swiftTestingConfig(
        ctx: FolderContext,
        fifoPipePath: string,
        testKind: TestKind,
        testList: string[],
        expandEnvVariables = false
    ): vscode.DebugConfiguration | null {
        return new DebugConfigurationFactory(
            ctx,
            fifoPipePath,
            testKind,
            TestLibrary.swiftTesting,
            testList,
            expandEnvVariables
        ).build();
    }

    public static xcTestConfig(
        ctx: FolderContext,
        testKind: TestKind,
        testList: string[],
        expandEnvVariables = false
    ): vscode.DebugConfiguration | null {
        return new DebugConfigurationFactory(
            ctx,
            "",
            testKind,
            TestLibrary.xctest,
            testList,
            expandEnvVariables
        ).build();
    }

    private constructor(
        private ctx: FolderContext,
        private fifoPipePath: string,
        private testKind: TestKind,
        private testLibrary: TestLibrary,
        private testList: string[],
        private expandEnvVariables = false
    ) {}

    /**
     * Builds a `vscode.DebugConfiguration` for running tests based on four main criteria:
     *
     * - Platform
     * - Toolchain
     * - Test Kind (coverage, debugging)
     * - Test Library (XCTest, swift-testing)
     */
    private build(): vscode.DebugConfiguration | null {
        if (!this.hasTestTarget) {
            return null;
        }

        switch (process.platform) {
            case "win32":
                return this.buildWindowsConfig();
            default:
                return this.buidDarwinConfig();
        }
    }

    /* eslint-disable no-case-declarations */
    private buidDarwinConfig(): vscode.DebugConfiguration | null {
        switch (this.testLibrary) {
            case "swift-testing":
                let args = [
                    "test",
                    ...(this.testKind === TestKind.coverage ? ["--enable-code-coverage"] : []),
                    "--enable-experimental-swift-testing",
                    "--experimental-event-stream-version",
                    "0",
                    "--experimental-event-stream-output",
                    this.fifoPipePath,
                ];

                if (this.swiftVersionGreaterOrEqual(6, 0, 0)) {
                    args = [...args, "--disable-xctest"];
                }

                return {
                    ...this.baseConfig,
                    program: this.swiftProgramPath,
                    args: this.addTestsToArgs(args),
                    env: {
                        ...this.testEnv,
                        ...this.sanitizerRuntimeEnvironment,
                        SWT_SF_SYMBOLS_ENABLED: "0",
                    },
                    // For coverage we need to rebuild so do the build/test all in one step,
                    // otherwise we do a build, then test, to give better progress.
                    preLaunchTask:
                        this.testKind === TestKind.coverage
                            ? undefined
                            : this.baseConfig.preLaunchTask,
                };
            case "XCTest":
                const swiftVersion = this.ctx.workspaceContext.toolchain.swiftVersion;
                if (
                    swiftVersion.isLessThan(new Version(5, 7, 0)) &&
                    swiftVersion.isGreaterThanOrEqual(new Version(5, 6, 0)) &&
                    process.platform === "darwin"
                ) {
                    // if debugging on macOS with Swift 5.6 we need to create a custom launch
                    // configuration so we can set the system architecture
                    return this.createDarwin56TestConfiguration();
                }

                let xcTestArgs = [
                    "test",
                    ...(this.testKind === TestKind.coverage ? ["--enable-code-coverage"] : []),
                ];
                if (this.swiftVersionGreaterOrEqual(6, 0, 0)) {
                    xcTestArgs = [
                        ...xcTestArgs,
                        "--enable-xctest",
                        "--disable-experimental-swift-testing",
                    ];
                }

                return {
                    ...this.baseConfig,
                    program: this.swiftProgramPath,
                    args: this.addTestsToArgs(xcTestArgs),
                    env: {
                        ...this.testEnv,
                        ...this.sanitizerRuntimeEnvironment,
                        SWT_SF_SYMBOLS_ENABLED: "0",
                    },
                    // For coverage we need to rebuild so do the build/test all in one step,
                    // otherwise we do a build, then test, to give better progress.
                    preLaunchTask:
                        this.testKind === TestKind.coverage
                            ? undefined
                            : this.baseConfig.preLaunchTask,
                };
            default:
                return null;
        }
    }

    private buildWindowsConfig(): vscode.DebugConfiguration | null {
        switch (this.testLibrary) {
            case TestLibrary.swiftTesting:
                // TODO: This is untested until rdar://128092675 is available in a windows SDK.
                return this.buidDarwinConfig();
            case TestLibrary.xctest:
                switch (this.testKind) {
                    case TestKind.coverage:
                        return this.buidDarwinConfig();
                    default:
                        const xcTestPath = this.ctx.workspaceContext.toolchain.xcTestPath;
                        const runtimePath = this.ctx.workspaceContext.toolchain.runtimePath;
                        const sdkroot =
                            configuration.sdk === "" ? process.env.SDKROOT : configuration.sdk;
                        const needsToSetTargetSDKPath =
                            configuration.debugger.useDebugAdapterFromToolchain ||
                            vscode.workspace.getConfiguration("lldb")?.get<string>("library");
                        let env = { ...this.testEnv };

                        // On Windows, add XCTest.dll to the Path
                        // and run the .xctest executable from the .build directory.
                        if (xcTestPath === undefined || sdkroot === undefined) {
                            return null;
                        }

                        if (xcTestPath !== runtimePath) {
                            env = {
                                ...env,
                                Path: `${xcTestPath};${env.Path ?? process.env.Path}`,
                            };
                        }

                        return {
                            ...this.baseConfig,
                            program: this.xcTestOutputPath,
                            args: [this.testList.join(",")],
                            env,
                            ...(needsToSetTargetSDKPath
                                ? {
                                      preRunCommands: [`settings set target.sdk-path ${sdkroot}`],
                                  }
                                : {}),
                        };
                }
        }
    }
    /* eslint-enable no-case-declarations */

    /**
     * Return custom Darwin test configuration that works with Swift 5.6
     **/
    private createDarwin56TestConfiguration(): vscode.DebugConfiguration | null {
        if (this.ctx.swiftPackage.getTargets(TargetType.test).length === 0) {
            return null;
        }

        let testFilterArg: string;
        const testList = this.testList.join(",");
        if (testList.length > 0) {
            testFilterArg = `-XCTest ${testList}`;
        } else {
            testFilterArg = "";
        }

        const { folder, nameSuffix } = getFolderAndNameSuffix(this.ctx, true);
        const buildDirectory = BuildFlags.buildDirectoryFromWorkspacePath(folder, true);
        // On macOS, find the path to xctest
        // and point it at the .xctest bundle from the configured build directory.
        const xctestPath = this.ctx.workspaceContext.toolchain.xcTestPath;
        if (xctestPath === undefined) {
            return null;
        }
        let arch: string;
        switch (os.arch()) {
            case "x64":
                arch = "x86_64";
                break;
            case "arm64":
                arch = "arm64e";
                break;
            default:
                return null;
        }
        const sanitizer = this.ctx.workspaceContext.toolchain.sanitizer(configuration.sanitizer);
        const envCommands = Object.entries({
            ...swiftRuntimeEnv(),
            ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
            ...sanitizer?.runtimeEnvironment,
        }).map(([key, value]) => `settings set target.env-vars ${key}="${value}"`);

        return {
            type: DebugAdapter.adapterName,
            request: "custom",
            sourceLanguages: ["swift"],
            name: `Test ${this.ctx.swiftPackage.name}`,
            targetCreateCommands: [`file -a ${arch} ${xctestPath}/xctest`],
            processCreateCommands: [
                ...envCommands,
                `process launch -w ${folder} -- ${testFilterArg} ${buildDirectory}/debug/${this.ctx.swiftPackage.name}PackageTests.xctest`,
            ],
            preLaunchTask: `swift: Build All${nameSuffix}`,
        };
    }

    private addTestsToArgs(args: string[]): string[] {
        return [...args, ...this.testList.flatMap(arg => ["--filter", regexEscapedString(arg)])];
    }

    private swiftVersionGreaterOrEqual(major: number, minor: number, patch: number): boolean {
        return this.ctx.workspaceContext.swiftVersion.isGreaterThanOrEqual(
            new Version(major, minor, patch)
        );
    }

    private get swiftProgramPath(): string {
        return this.ctx.workspaceContext.toolchain.getToolchainExecutable("swift");
    }

    private get buildDirectory(): string {
        const { folder } = getFolderAndNameSuffix(this.ctx, this.expandEnvVariables);
        return BuildFlags.buildDirectoryFromWorkspacePath(folder, true);
    }

    private get xcTestOutputPath(): string {
        return path.join(
            this.buildDirectory,
            "debug",
            this.ctx.swiftPackage.name + "PackageTests.xctest"
        );
    }

    private get sanitizerRuntimeEnvironment() {
        return this.ctx.workspaceContext.toolchain.sanitizer(configuration.sanitizer)
            ?.runtimeEnvironment;
    }

    private get testEnv() {
        return {
            ...swiftRuntimeEnv(),
            ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
        };
    }

    private get baseConfig() {
        const { folder, nameSuffix } = getFolderAndNameSuffix(this.ctx, this.expandEnvVariables);
        return {
            type: DebugAdapter.adapterName,
            request: "launch",
            sourceLanguages: ["swift"],
            name: `Test ${this.ctx.swiftPackage.name}`,
            cwd: folder,
            args: [],
            preLaunchTask: `swift: Build All${nameSuffix}`,
            terminal: "console",
        };
    }

    private get hasTestTarget(): boolean {
        return this.ctx.swiftPackage.getTargets(TargetType.test).length > 0;
    }
}

export function getFolderAndNameSuffix(
    ctx: FolderContext,
    expandEnvVariables = false
): { folder: string; nameSuffix: string } {
    const workspaceFolder = expandEnvVariables
        ? ctx.workspaceFolder.uri.fsPath
        : `\${workspaceFolder:${ctx.workspaceFolder.name}}`;
    let folder: string;
    let nameSuffix: string;
    if (ctx.relativePath.length === 0) {
        folder = workspaceFolder;
        nameSuffix = "";
    } else {
        folder = path.join(workspaceFolder, ctx.relativePath);
        nameSuffix = ` (${ctx.relativePath})`;
    }
    return { folder: folder, nameSuffix: nameSuffix };
}
