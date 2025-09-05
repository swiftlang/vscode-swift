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
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "../FolderContext";
import { TargetType } from "../SwiftPackage";
import { TestKind, isDebugging, isRelease } from "../TestExplorer/TestKind";
import { TestLibrary } from "../TestExplorer/TestRunner";
import configuration from "../configuration";
import { SwiftLogger } from "../logging/SwiftLogger";
import { buildOptions } from "../tasks/SwiftTaskProvider";
import { BuildFlags } from "../toolchain/BuildFlags";
import { packageName } from "../utilities/tasks";
import { regexEscapedString, swiftRuntimeEnv } from "../utilities/utilities";
import { Version } from "../utilities/version";
import { SWIFT_LAUNCH_CONFIG_TYPE } from "./debugAdapter";
import { updateLaunchConfigForCI } from "./lldb";

export class BuildConfigurationFactory {
    public static buildAll(
        ctx: FolderContext,
        isTestBuild: boolean,
        isRelease: boolean
    ): Promise<vscode.DebugConfiguration> {
        return new BuildConfigurationFactory(ctx, isTestBuild, isRelease).build();
    }

    private constructor(
        private ctx: FolderContext,
        private isTestBuild: boolean,
        private isRelease: boolean
    ) {}

    private async build(): Promise<vscode.DebugConfiguration> {
        let additionalArgs = buildOptions(this.ctx.toolchain);
        if ((await this.ctx.swiftPackage.getTargets(TargetType.test)).length > 0) {
            additionalArgs.push(...this.testDiscoveryFlag(this.ctx));
        }

        if (this.isRelease) {
            additionalArgs = [...additionalArgs, "-c", "release"];
        }

        // don't build tests for iOS etc as they don't compile
        if (this.ctx.toolchain.buildFlags.getDarwinTarget() === undefined) {
            additionalArgs = ["--build-tests", ...additionalArgs];
            if (this.isRelease) {
                additionalArgs = [...additionalArgs, "-Xswiftc", "-enable-testing"];
            }
            if (this.isTestBuild) {
                additionalArgs = [
                    ...additionalArgs,
                    ...configuration.folder(this.ctx.workspaceFolder).additionalTestArguments,
                ];
            }
        }

        return {
            ...(await this.baseConfig),
            program: "swift",
            args: ["build", ...additionalArgs],
            env: {},
        };
    }

    /** flag for enabling test discovery */
    private testDiscoveryFlag(ctx: FolderContext): string[] {
        // Test discovery is only available in SwiftPM 5.1 and later.
        if (ctx.swiftVersion.isLessThan(new Version(5, 1, 0))) {
            return [];
        }
        // Test discovery is always enabled on Darwin.
        if (process.platform !== "darwin") {
            const hasLinuxMain = ctx.linuxMain.exists;
            const testDiscoveryByDefault = ctx.swiftVersion.isGreaterThanOrEqual(
                new Version(5, 4, 0)
            );
            if (hasLinuxMain || !testDiscoveryByDefault) {
                return ["--enable-test-discovery"];
            }
        }
        return [];
    }

    private get baseConfig() {
        return getBaseConfig(this.ctx, true);
    }
}

export class SwiftTestingBuildAguments {
    private constructor(
        public fifoPipePath: string,
        public attachmentPath: string | undefined
    ) {}

    public static build(
        fifoPipePath: string,
        attachmentPath: string | undefined
    ): SwiftTestingBuildAguments {
        return new SwiftTestingBuildAguments(fifoPipePath, attachmentPath);
    }
}

export class SwiftTestingConfigurationSetup {
    public static async setupAttachmentFolder(
        folderContext: FolderContext,
        testRunTime: number
    ): Promise<string | undefined> {
        const attachmentPath = SwiftTestingConfigurationSetup.resolveAttachmentPath(
            folderContext,
            testRunTime
        );
        if (attachmentPath) {
            // Create the directory if it doesn't exist.
            await fs.mkdir(attachmentPath, { recursive: true });

            return attachmentPath;
        }

        return attachmentPath;
    }

    public static async cleanupAttachmentFolder(
        folderContext: FolderContext,
        testRunTime: number,
        logger: SwiftLogger
    ): Promise<void> {
        const attachmentPath = SwiftTestingConfigurationSetup.resolveAttachmentPath(
            folderContext,
            testRunTime
        );

        if (attachmentPath) {
            try {
                // If no attachments were written during the test run clean up the folder
                // that was created to contain them to prevent accumulation of empty folders
                // after every run.
                const files = await fs.readdir(attachmentPath);
                if (files.length === 0) {
                    await fs.rmdir(attachmentPath);
                }
            } catch (error) {
                logger.error(`Failed to clean up attachment path: ${error}`);
            }
        }
    }

    private static resolveAttachmentPath(
        folderContext: FolderContext,
        testRunTime: number
    ): string | undefined {
        let attachmentPath = configuration.folder(folderContext.workspaceFolder).attachmentsPath;
        if (attachmentPath.length > 0) {
            // If the attachment path is relative, resolve it relative to the workspace folder.
            if (!path.isAbsolute(attachmentPath)) {
                attachmentPath = path.resolve(folderContext.folder.fsPath, attachmentPath);
            }

            const dateString = this.dateString(testRunTime);
            return path.join(attachmentPath, dateString);
        }
        return undefined;
    }

    private static dateString(time: number): string {
        const date = new Date(time);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}-${String(date.getSeconds()).padStart(2, "0")}`;
    }
}

/**
 * Creates `vscode.DebugConfiguration`s for different combinations of
 * testing library, test kind and platform. Use the static `swiftTestingConfig`
 * and `xcTestConfig` functions to create
 */
export class TestingConfigurationFactory {
    public static swiftTestingConfig(
        ctx: FolderContext,
        buildArguments: SwiftTestingBuildAguments,
        testKind: TestKind,
        testList: string[],
        expandEnvVariables = false
    ): Promise<vscode.DebugConfiguration | null> {
        return new TestingConfigurationFactory(
            ctx,
            testKind,
            TestLibrary.swiftTesting,
            testList,
            buildArguments,
            expandEnvVariables
        ).build();
    }

    public static xcTestConfig(
        ctx: FolderContext,
        testKind: TestKind,
        testList: string[],
        expandEnvVariables = false
    ): Promise<vscode.DebugConfiguration | null> {
        return new TestingConfigurationFactory(
            ctx,
            testKind,
            TestLibrary.xctest,
            testList,
            undefined,
            expandEnvVariables
        ).build();
    }

    public static testExecutableOutputPath(
        ctx: FolderContext,
        testKind: TestKind,
        testLibrary: TestLibrary
    ): Promise<string> {
        return new TestingConfigurationFactory(
            ctx,
            testKind,
            testLibrary,
            [],
            undefined,
            true
        ).testExecutableOutputPath();
    }

    private constructor(
        private ctx: FolderContext,
        private testKind: TestKind,
        private testLibrary: TestLibrary,
        private testList: string[],
        private swiftTestingArguments?: SwiftTestingBuildAguments,
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
    private async build(): Promise<vscode.DebugConfiguration | null> {
        if (!(await this.hasTestTarget)) {
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
    private async buildWindowsConfig(): Promise<vscode.DebugConfiguration | null> {
        if (isDebugging(this.testKind)) {
            const testEnv = {
                ...swiftRuntimeEnv(),
                ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
            };
            // On Windows, add XCTest.dll/Testing.dll to the Path
            // and run the .xctest executable from the .build directory.
            const runtimePath = this.ctx.toolchain.runtimePath;
            const xcTestPath = this.ctx.toolchain.xcTestPath;
            if (xcTestPath && xcTestPath !== runtimePath) {
                testEnv.Path = `${xcTestPath};${testEnv.Path ?? process.env.Path}`;
            }

            const swiftTestingPath = this.ctx.toolchain.swiftTestingPath;
            if (swiftTestingPath && swiftTestingPath !== runtimePath) {
                testEnv.Path = `${swiftTestingPath};${testEnv.Path ?? process.env.Path}`;
            }

            const baseConfig = await this.baseConfig();
            return {
                ...baseConfig,
                program: await this.testExecutableOutputPath(),
                args: this.debuggingTestExecutableArgs(),
                env: testEnv,
            };
        } else {
            return this.buildDarwinConfig();
        }
    }

    /* eslint-disable no-case-declarations */
    private async buildLinuxConfig(): Promise<vscode.DebugConfiguration | null> {
        if (isDebugging(this.testKind) && this.testLibrary === TestLibrary.xctest) {
            const baseConfig = await this.baseConfig();
            return {
                ...baseConfig,
                program: await this.testExecutableOutputPath(),
                args: this.debuggingTestExecutableArgs(),
                env: {
                    ...swiftRuntimeEnv(
                        process.env,
                        this.ctx.toolchain.runtimePath ?? configuration.runtimePath
                    ),
                    ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
                },
            };
        } else {
            return this.buildDarwinConfig();
        }
    }

    private async buildDarwinConfig(): Promise<vscode.DebugConfiguration | null> {
        const baseConfig = await this.baseConfig();
        switch (this.testLibrary) {
            case TestLibrary.swiftTesting:
                switch (this.testKind) {
                    case TestKind.debugRelease:
                    case TestKind.debug:
                        // In the debug case we need to build the testing executable and then
                        // launch it with LLDB instead of going through `swift test`.
                        const toolchain = this.ctx.toolchain;
                        const libraryPath = toolchain.swiftTestingLibraryPath();
                        const frameworkPath = toolchain.swiftTestingFrameworkPath();
                        const swiftPMTestingHelperPath = toolchain.swiftPMTestingHelperPath;
                        const env = {
                            ...this.testEnv,
                            ...this.sanitizerRuntimeEnvironment,
                            DYLD_FRAMEWORK_PATH: frameworkPath,
                            DYLD_LIBRARY_PATH: libraryPath,
                            SWT_SF_SYMBOLS_ENABLED: "0",
                            SWT_EXPERIMENTAL_EVENT_STREAM_FIELDS_ENABLED: "1",
                        };

                        // Toolchains that contain https://github.com/swiftlang/swift-package-manager/commit/844bd137070dcd18d0f46dd95885ef7907ea0697
                        // produce a single testing binary for both xctest and swift-testing (called <ProductName>.xctest).
                        // We can continue to invoke it with the xctest utility, but to run swift-testing tests
                        // we need to invoke then using the swiftpm-testing-helper utility. If this helper utility exists
                        // then we know we're working with a unified binary.
                        if (swiftPMTestingHelperPath) {
                            const result = {
                                ...baseConfig,
                                program: swiftPMTestingHelperPath,
                                args: this.addBuildOptionsToArgs(
                                    this.addTestsToArgs(
                                        this.addSwiftTestingFlagsArgs([
                                            "--test-bundle-path",
                                            await this.unifiedTestingOutputPath(),
                                            "--testing-library",
                                            "swift-testing",
                                        ])
                                    )
                                ),
                                env,
                            };
                            return result;
                        }

                        const result = {
                            ...baseConfig,
                            program: await this.testExecutableOutputPath(),
                            args: this.debuggingTestExecutableArgs(),
                            env,
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
                            ...baseConfig,
                            program: this.swiftProgramPath,
                            args: this.addBuildOptionsToArgs(this.addTestsToArgs(args)),
                            env: {
                                ...this.testEnv,
                                ...this.sanitizerRuntimeEnvironment,
                                SWT_SF_SYMBOLS_ENABLED: "0",
                                SWT_EXPERIMENTAL_EVENT_STREAM_FIELDS_ENABLED: "1",
                            },
                            // For coverage we need to rebuild so do the build/test all in one step,
                            // otherwise we do a build, then test, to give better progress.
                            preLaunchTask:
                                this.testKind === TestKind.coverage
                                    ? undefined
                                    : baseConfig.preLaunchTask,
                        };
                }
            case TestLibrary.xctest:
                switch (this.testKind) {
                    case TestKind.debugRelease:
                    case TestKind.debug:
                        const xcTestPath = this.ctx.toolchain.xcTestPath;
                        // On macOS, find the path to xctest
                        // and point it at the .xctest bundle from the configured build directory.
                        if (xcTestPath === undefined) {
                            return null;
                        }
                        return {
                            ...baseConfig,
                            program: path.join(xcTestPath, "xctest"),
                            args: this.addXCTestExecutableTestsToArgs([
                                await this.xcTestOutputPath(),
                            ]),
                            env: {
                                ...this.testEnv,
                                ...this.sanitizerRuntimeEnvironment,
                                SWIFT_TESTING_ENABLED: "0",
                            },
                        };
                    default:
                        const swiftVersion = this.ctx.toolchain.swiftVersion;
                        if (
                            swiftVersion.isLessThan(new Version(5, 7, 0)) &&
                            swiftVersion.isGreaterThanOrEqual(new Version(5, 6, 0)) &&
                            process.platform === "darwin"
                        ) {
                            // if debugging on macOS with Swift 5.6 we need to create a custom launch
                            // configuration so we can set the system architecture
                            return await this.createDarwin56TestConfiguration();
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
                            ...baseConfig,
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
                                    : baseConfig.preLaunchTask,
                        };
                }
        }
    }
    /* eslint-enable no-case-declarations */

    /**
     * Return custom Darwin test configuration that works with Swift 5.6
     **/
    private async createDarwin56TestConfiguration(): Promise<vscode.DebugConfiguration | null> {
        if ((await this.ctx.swiftPackage.getTargets(TargetType.test)).length === 0) {
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
        const xctestPath = this.ctx.toolchain.xcTestPath;
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
        const sanitizer = this.ctx.toolchain.sanitizer(configuration.sanitizer);
        const envCommands = Object.entries({
            ...swiftRuntimeEnv(),
            ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
            ...sanitizer?.runtimeEnvironment,
        }).map(([key, value]) => `settings set target.env-vars ${key}="${value}"`);

        return {
            type: SWIFT_LAUNCH_CONFIG_TYPE,
            request: "custom",
            name: `Test ${await this.ctx.swiftPackage.name}`,
            targetCreateCommands: [`file -a ${arch} ${xctestPath}/xctest`],
            processCreateCommands: [
                ...envCommands,
                `process launch -w ${folder} -- ${testFilterArg} ${this.xcTestOutputPath()}`,
            ],
            preLaunchTask: `swift: Build All${nameSuffix}`,
        };
    }

    private addSwiftTestingFlagsArgs(args: string[]): string[] {
        if (!this.swiftTestingArguments) {
            throw new Error(
                "Attempted to create swift testing flags without any swift testing arguments. This is an internal error, please report an issue at https://github.com/swiftlang/vscode-swift/issues/new"
            );
        }

        // Starting in 6.3 the version string should match the toolchain version.
        let versionString = "0";
        if (this.ctx.toolchain.swiftVersion.isGreaterThanOrEqual(new Version(6, 3, 0))) {
            versionString = `${this.ctx.toolchain.swiftVersion.major}.${this.ctx.toolchain.swiftVersion.minor}`;
        }

        const swiftTestingArgs = [
            ...this.ctx.toolchain.buildFlags.withAdditionalFlags(args),
            "--enable-swift-testing",
            "--experimental-event-stream-version",
            versionString,
            "--event-stream-output-path",
            this.swiftTestingArguments.fifoPipePath,
        ];

        if (this.swiftTestingArguments.attachmentPath && this.swiftVersionGreaterOrEqual(6, 1, 0)) {
            swiftTestingArgs.push(
                "--experimental-attachments-path",
                this.swiftTestingArguments.attachmentPath
            );
        }

        return swiftTestingArgs;
    }

    private addTestsToArgs(args: string[]): string[] {
        return [
            ...args,
            ...this.testList.flatMap(arg => [
                "--filter",
                regexEscapedString(arg, new Set(["$", "^"])),
            ]),
        ];
    }

    private addXCTestExecutableTestsToArgs(args: string[]): string[] {
        if (args.length === 0) {
            return args;
        }
        return ["-XCTest", this.testList.join(","), ...args];
    }

    private addBuildOptionsToArgs(args: string[]): string[] {
        let result = [...args, ...buildOptions(this.ctx.toolchain, isDebugging(this.testKind))];
        if (isRelease(this.testKind)) {
            result = [...result, "-c", "release", "-Xswiftc", "-enable-testing"];
        }

        // Add in any user specified test arguments.
        result = [
            ...result,
            ...configuration.folder(this.ctx.workspaceFolder).additionalTestArguments,
        ];

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
        return this.ctx.swiftVersion.isGreaterThanOrEqual(new Version(major, minor, patch));
    }

    private get swiftProgramPath(): string {
        return this.ctx.toolchain.getToolchainExecutable("swift");
    }

    private get buildDirectory(): string {
        const { folder } = getFolderAndNameSuffix(this.ctx, this.expandEnvVariables);
        return BuildFlags.buildDirectoryFromWorkspacePath(folder, true);
    }

    private get artifactFolderForTestKind(): string {
        const mode = isRelease(this.testKind) ? "release" : "debug";
        const triple = this.ctx.toolchain.unversionedTriple;
        return triple ? path.join(triple, mode) : mode;
    }

    private async xcTestOutputPath(): Promise<string> {
        const packageName = await this.ctx.swiftPackage.name;
        return path.join(
            this.buildDirectory,
            this.artifactFolderForTestKind,
            `${packageName}PackageTests.xctest`
        );
    }

    private async unifiedTestingOutputPath(): Promise<string> {
        // The unified binary that contains both swift-testing and XCTests
        // is named the same as the old style .xctest binary. The swiftpm-testing-helper
        // requires the full path to the binary.
        if (process.platform === "darwin") {
            const packageName = await this.ctx.swiftPackage.name;
            return path.join(
                await this.xcTestOutputPath(),
                "Contents",
                "MacOS",
                `${packageName}PackageTests`
            );
        } else {
            return this.xcTestOutputPath();
        }
    }

    private async testExecutableOutputPath(): Promise<string> {
        switch (this.testLibrary) {
            case TestLibrary.swiftTesting:
                return this.unifiedTestingOutputPath();
            case TestLibrary.xctest:
                return this.xcTestOutputPath();
        }
    }

    private debuggingTestExecutableArgs(): string[] {
        switch (this.testLibrary) {
            case TestLibrary.swiftTesting: {
                const swiftTestingArgs = ["--testing-library", "swift-testing"];

                return this.addBuildOptionsToArgs(
                    this.addTestsToArgs(this.addSwiftTestingFlagsArgs(swiftTestingArgs))
                );
            }
            case TestLibrary.xctest:
                return [this.testList.join(",")];
        }
    }

    private get sanitizerRuntimeEnvironment() {
        return this.ctx.toolchain.sanitizer(configuration.sanitizer)?.runtimeEnvironment;
    }

    private get testEnv() {
        return {
            ...swiftRuntimeEnv(),
            ...configuration.folder(this.ctx.workspaceFolder).testEnvironmentVariables,
        };
    }

    private async baseConfig(): Promise<ReturnType<typeof getBaseConfig>> {
        return getBaseConfig(this.ctx, this.expandEnvVariables);
    }

    private get hasTestTarget(): Promise<boolean> {
        return this.ctx.swiftPackage
            .getTargets(TargetType.test)
            .then(targets => targets.length > 0);
    }
}

async function getBaseConfig(ctx: FolderContext, expandEnvVariables: boolean) {
    const { folder, nameSuffix } = getFolderAndNameSuffix(ctx, expandEnvVariables);
    const packageName = await ctx.swiftPackage.name;
    return updateLaunchConfigForCI({
        type: SWIFT_LAUNCH_CONFIG_TYPE,
        request: "launch",
        sourceLanguages: ["swift"],
        name: `Test ${packageName}`,
        cwd: folder,
        args: [],
        preLaunchTask: `swift: Build All${nameSuffix}`,
        terminal: "console",
    });
}

export function getFolderAndNameSuffix(
    ctx: FolderContext,
    expandEnvVariables = false,
    platform?: "posix" | "win32"
): { folder: string; nameSuffix: string } {
    const nodePath = platform === "posix" ? path.posix : platform === "win32" ? path.win32 : path;
    const workspaceFolder = expandEnvVariables
        ? ctx.workspaceFolder.uri.fsPath
        : `\${workspaceFolder:${ctx.workspaceFolder.name}}`;
    let folder: string;
    let nameSuffix;
    const pkgName = packageName(ctx);
    if (pkgName) {
        folder = nodePath.join(workspaceFolder, ctx.relativePath);
        nameSuffix = ` (${packageName(ctx)})`;
    } else {
        folder = workspaceFolder;
        nameSuffix = "";
    }
    return { folder: folder, nameSuffix: nameSuffix };
}
