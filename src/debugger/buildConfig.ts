//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
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
import { TestLibrary } from "../TestExplorer/TestRunner";
import { buildOptions } from "../tasks/SwiftTaskProvider";
import { TestKind, isDebugging, isRelease } from "../TestExplorer/TestKind";

/**
 * Creates `vscode.DebugConfiguration`s for different combinations of
 * testing library, test kind and platform. Use the static `swiftTestingConfig`
 * and `xcTestConfig` functions to create
 */
export class TestingDebugConfigurationFactory {
    public static swiftTestingConfig(
        ctx: FolderContext,
        fifoPipePath: string,
        testKind: TestKind,
        testList: string[],
        expandEnvVariables = false
    ): vscode.DebugConfiguration | null {
        return new TestingDebugConfigurationFactory(
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
        return new TestingDebugConfigurationFactory(
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
            case "darwin":
                return this.buildDarwinConfig();
            case "win32":
                return this.buildWindowsConfig();
            default:
                return this.buildLinuxConfig();
        }
    }

    /* eslint-disable no-case-declarations */
    private buildWindowsConfig(): vscode.DebugConfiguration | null {
        if (isDebugging(this.testKind)) {
            const testEnv = {
                ...swiftRuntimeEnv(),
                ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
            };
            // On Windows, add XCTest.dll to the Path
            // and run the .xctest executable from the .build directory.
            const runtimePath = this.ctx.workspaceContext.toolchain.runtimePath;
            const xcTestPath = this.ctx.workspaceContext.toolchain.xcTestPath;
            if (xcTestPath && xcTestPath !== runtimePath) {
                testEnv.Path = `${xcTestPath};${testEnv.Path ?? process.env.Path}`;
            }

            return {
                ...this.baseConfig,
                program: this.testExecutableOutputPath,
                args: this.debuggingTestExecutableArgs,
                env: testEnv,
            };
        } else {
            return this.buildDarwinConfig();
        }
    }

    /* eslint-disable no-case-declarations */
    private buildLinuxConfig(): vscode.DebugConfiguration | null {
        if (isDebugging(this.testKind) && this.testLibrary === TestLibrary.xctest) {
            return {
                ...this.baseConfig,
                program: this.testExecutableOutputPath,
                args: this.debuggingTestExecutableArgs,
                env: {
                    ...swiftRuntimeEnv(),
                    ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
                },
            };
        } else {
            return this.buildDarwinConfig();
        }
    }

    private buildDarwinConfig(): vscode.DebugConfiguration | null {
        switch (this.testLibrary) {
            case TestLibrary.swiftTesting:
                switch (this.testKind) {
                    case TestKind.debugRelease:
                    case TestKind.debug:
                        // In the debug case we need to build the .swift-testing executable and then
                        // launch it with LLDB instead of going through `swift test`.
                        const toolchain = this.ctx.workspaceContext.toolchain;
                        const libraryPath = toolchain.swiftTestingLibraryPath();
                        const frameworkPath = toolchain.swiftTestingFrameworkPath();
                        const result = {
                            ...this.baseConfig,
                            program: this.swiftTestingOutputPath,
                            args: this.addBuildOptionsToArgs(
                                this.addTestsToArgs(this.addSwiftTestingFlagsArgs([]))
                            ),
                            env: {
                                ...this.testEnv,
                                ...this.sanitizerRuntimeEnvironment,
                                DYLD_FRAMEWORK_PATH: frameworkPath,
                                DYLD_LIBRARY_PATH: libraryPath,
                                SWT_SF_SYMBOLS_ENABLED: "0",
                            },
                        };
                        return result;
                    default:
                        let args = this.addSwiftTestingFlagsArgs([
                            "test",
                            ...(this.testKind === TestKind.coverage
                                ? ["--enable-code-coverage"]
                                : []),
                        ]);

                        if (this.swiftVersionGreaterOrEqual(6, 0, 0)) {
                            args = [...args, "--disable-xctest"];
                        }

                        return {
                            ...this.baseConfig,
                            program: this.swiftProgramPath,
                            args: this.addBuildOptionsToArgs(this.addTestsToArgs(args)),
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
                }
            case TestLibrary.xctest:
                switch (this.testKind) {
                    case TestKind.debugRelease:
                    case TestKind.debug:
                        const xcTestPath = this.ctx.workspaceContext.toolchain.xcTestPath;
                        // On macOS, find the path to xctest
                        // and point it at the .xctest bundle from the configured build directory.
                        if (xcTestPath === undefined) {
                            return null;
                        }
                        return {
                            ...this.baseConfig,
                            program: path.join(xcTestPath, "xctest"),
                            args: this.addXCTestExecutableTestsToArgs([this.xcTestOutputPath]),
                            env: {
                                ...this.testEnv,
                                ...this.sanitizerRuntimeEnvironment,
                                SWIFT_TESTING_ENABLED: "0",
                            },
                        };
                    default:
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
                            ...(this.testKind === TestKind.coverage
                                ? ["--enable-code-coverage"]
                                : []),
                        ];
                        if (this.swiftVersionGreaterOrEqual(6, 0, 0)) {
                            xcTestArgs = [
                                ...xcTestArgs,
                                "--enable-xctest",
                                "--disable-experimental-swift-testing",
                            ];
                        }

                        if (this.testKind === TestKind.parallel) {
                            xcTestArgs = [...xcTestArgs, "--parallel"];
                        }

                        return {
                            ...this.baseConfig,
                            program: this.swiftProgramPath,
                            args: this.addBuildOptionsToArgs(this.addTestsToArgs(xcTestArgs)),
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
                `process launch -w ${folder} -- ${testFilterArg} ${this.xcTestOutputPath}`,
            ],
            preLaunchTask: `swift: Build All${nameSuffix}`,
        };
    }

    private addSwiftTestingFlagsArgs(args: string[]): string[] {
        return [
            ...args,
            "--enable-experimental-swift-testing",
            "--experimental-event-stream-version",
            "0",
            "--experimental-event-stream-output",
            this.fifoPipePath,
        ];
    }

    private addTestsToArgs(args: string[]): string[] {
        return [...args, ...this.testList.flatMap(arg => ["--filter", regexEscapedString(arg)])];
    }

    private addXCTestExecutableTestsToArgs(args: string[]): string[] {
        if (args.length === 0) {
            return args;
        }
        return ["-XCTest", this.testList.join(","), ...args];
    }

    private addBuildOptionsToArgs(args: string[]): string[] {
        let result = [
            ...args,
            ...buildOptions(this.ctx.workspaceContext.toolchain, isDebugging(this.testKind)),
        ];
        if (isRelease(this.testKind)) {
            result = [...result, "-c", "release", "-Xswiftc", "-enable-testing"];
        }
        // `link.exe` doesn't support duplicate weak symbols, and lld-link in an effort to
        // match link.exe also doesn't support them by default. We can use `-lldmingw` to get
        // lld-link to allow duplicate weak symbols, but that also changes its library search
        // path behavior, which could(?) be unintended.
        //
        // On the `next` branch (6.1?) in llvm, the duplicate symbol behavior now has its own flag
        // `-lld-allow-duplicate-weak` (https://github.com/llvm/llvm-project/pull/68077).
        // Once this is available we should use it if possible, as it will suppress the warnings
        // seen with `-lldmingw`.
        //
        // SEE: rdar://129337999
        if (process.platform === "win32" && this.testKind === TestKind.coverage) {
            result = [...result, "-Xlinker", "-lldmingw"];
        }
        return result;
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

    private get artifactFolderForTestKind(): string {
        return isRelease(this.testKind) ? "release" : "debug";
    }

    private get xcTestOutputPath(): string {
        return path.join(
            this.buildDirectory,
            this.artifactFolderForTestKind,
            this.ctx.swiftPackage.name + "PackageTests.xctest"
        );
    }

    private get swiftTestingOutputPath(): string {
        return path.join(
            this.buildDirectory,
            this.artifactFolderForTestKind,
            `${this.ctx.swiftPackage.name}PackageTests.swift-testing`
        );
    }

    private get testExecutableOutputPath(): string {
        switch (this.testLibrary) {
            case TestLibrary.swiftTesting:
                return this.swiftTestingOutputPath;
            case TestLibrary.xctest:
                return this.xcTestOutputPath;
        }
    }

    private get debuggingTestExecutableArgs(): string[] {
        switch (this.testLibrary) {
            case TestLibrary.swiftTesting:
                return this.addBuildOptionsToArgs(
                    this.addTestsToArgs(this.addSwiftTestingFlagsArgs([]))
                );
            case TestLibrary.xctest:
                return [this.testList.join(",")];
        }
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
