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
import * as assert from "assert";
import * as os from "os";
import { match } from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import configuration from "@src/configuration";
import { SwiftExecution } from "@src/tasks/SwiftExecution";
import {
    SwiftTaskProvider,
    buildOptions,
    createSwiftTask,
    getBuildAllTask,
    platformDebugBuildOptions,
} from "@src/tasks/SwiftTaskProvider";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { Sanitizer } from "@src/toolchain/Sanitizer";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import { Version } from "@src/utilities/version";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";

suite("SwiftTaskProvider Unit Test Suite", () => {
    let workspaceContext: MockedObject<WorkspaceContext>;
    let workspaceFolder: vscode.WorkspaceFolder;
    let toolchain: MockedObject<SwiftToolchain>;
    let buildFlags: MockedObject<BuildFlags>;

    const platformMock = mockGlobalValue(process, "platform");

    setup(() => {
        buildFlags = mockObject<BuildFlags>({
            withAdditionalFlags: mockFn(s => s.callsFake(arr => arr)),
        });
        toolchain = mockObject<SwiftToolchain>({
            swiftVersion: new Version(6, 0, 0),
            buildFlags: instance(buildFlags),
            sanitizer: mockFn(),
            getToolchainExecutable: mockFn(s => s.withArgs("swift").returns("/path/to/bin/swift")),
        });
        const folderContext = mockObject<FolderContext>({
            workspaceContext: instance(workspaceContext),
            workspaceFolder,
            toolchain: instance(toolchain),
        });
        workspaceContext = mockObject<WorkspaceContext>({
            globalToolchain: instance(toolchain),
            currentFolder: instance(folderContext),
        });
        workspaceFolder = {
            uri: vscode.Uri.file("/path/to/workspace"),
            name: "myWorkspace",
            index: 0,
        };
    });

    suite("platformDebugBuildOptions", () => {
        test("windows, before 5.9", () => {
            platformMock.setValue("win32");
            toolchain.swiftVersion = new Version(5, 8, 1);

            assert.deepEqual(platformDebugBuildOptions(instance(toolchain)), [
                "-Xswiftc",
                "-g",
                "-Xswiftc",
                "-use-ld=lld",
                "-Xlinker",
                "-debug:dwarf",
            ]);
        });

        test("windows, after 5.9", () => {
            platformMock.setValue("win32");
            const expected = ["-Xlinker", "-debug:dwarf"];

            toolchain.swiftVersion = new Version(5, 9, 0);
            assert.deepEqual(platformDebugBuildOptions(instance(toolchain)), expected);

            toolchain.swiftVersion = new Version(6, 0, 0);
            assert.deepEqual(platformDebugBuildOptions(instance(toolchain)), expected);
        });

        test("linux", () => {
            platformMock.setValue("linux");

            assert.deepEqual(platformDebugBuildOptions(instance(toolchain)), []);
        });

        test("macOS", () => {
            platformMock.setValue("darwin");

            assert.deepEqual(platformDebugBuildOptions(instance(toolchain)), []);
        });
    });

    suite("buildOptions", () => {
        const buildArgs = mockGlobalValue(configuration, "buildArguments");
        const diagnosticsStyle = mockGlobalValue(configuration, "diagnosticsStyle");
        const sanitizerConfig = mockGlobalValue(configuration, "sanitizer");

        setup(() => {
            platformMock.setValue("darwin");
            buildArgs.setValue([]);
            diagnosticsStyle.setValue("default");
        });

        test("include debug options", () => {
            platformMock.setValue("win32");
            assert.deepEqual(buildOptions(instance(toolchain), true), ["-Xlinker", "-debug:dwarf"]);
        });

        test("don't include debug options", () => {
            platformMock.setValue("win32");
            assert.deepEqual(buildOptions(instance(toolchain), false), []);
        });

        test("include diagnostic style", () => {
            diagnosticsStyle.setValue("llvm");
            assert.deepEqual(buildOptions(instance(toolchain), false), [
                "-Xswiftc",
                "-diagnostic-style=llvm",
            ]);
        });

        test("include sanitizer flags", () => {
            const sanitizer = mockObject<Sanitizer>({
                buildFlags: ["--sanitize=thread"],
            });
            toolchain.sanitizer.withArgs("thread").returns(instance(sanitizer));
            sanitizerConfig.setValue("thread");

            assert.deepEqual(buildOptions(instance(toolchain), false), ["--sanitize=thread"]);
        });

        test("include build flags", () => {
            buildArgs.setValue(["-DFOO"]);

            assert.deepEqual(buildOptions(instance(toolchain), false), ["-DFOO"]);
        });
    });

    suite("createSwiftTask", () => {
        const envConfig = mockGlobalValue(configuration, "swiftEnvironmentVariables");

        test("uses SwiftExecution", () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                instance(toolchain)
            );
            assert.equal(task.execution instanceof SwiftExecution, true);
        });

        test("uses toolchain swift path", () => {
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                instance(toolchain)
            );
            assert.equal(task.execution.command, "/path/to/bin/swift");
        });

        test("include sdk flags", () => {
            buildFlags.withAdditionalFlags
                .withArgs(match(["build"]))
                .returns(["build", "--sdk", "/path/to/sdk", "--replace-scm-with-registry"]);
            const task = createSwiftTask(
                ["build"],
                "build",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                instance(toolchain)
            );
            assert.deepEqual(task.execution.args, [
                "build",
                "--sdk",
                "/path/to/sdk",
                "--replace-scm-with-registry",
            ]);
        });

        test("include environment", () => {
            envConfig.setValue({ FOO: "1" });
            const task = createSwiftTask(
                ["--help"],
                "help",
                { cwd: workspaceFolder.uri, scope: vscode.TaskScope.Workspace },
                instance(toolchain),
                { BAZ: "2" }
            );
            assert.deepEqual(task.execution.options.env, { FOO: "1", BAZ: "2" });
        });

        test("include presentation", () => {
            envConfig.setValue({ FOO: "1" });
            const task = createSwiftTask(
                ["--help"],
                "help",
                {
                    cwd: workspaceFolder.uri,
                    scope: vscode.TaskScope.Workspace,
                    presentationOptions: { reveal: vscode.TaskRevealKind.Always },
                },
                instance(toolchain),
                { BAZ: "2" }
            );
            assert.deepEqual(task.presentationOptions, { reveal: vscode.TaskRevealKind.Always });
        });

        test("include group", () => {
            envConfig.setValue({ FOO: "1" });
            const task = createSwiftTask(
                ["--help"],
                "help",
                {
                    cwd: workspaceFolder.uri,
                    scope: vscode.TaskScope.Workspace,
                    group: vscode.TaskGroup.Build,
                },
                instance(toolchain),
                { BAZ: "2" }
            );
            assert.equal(task.group, vscode.TaskGroup.Build);
        });

        test("include showBuildStatus", () => {
            envConfig.setValue({ FOO: "1" });
            const task = createSwiftTask(
                ["--help"],
                "help",
                {
                    cwd: workspaceFolder.uri,
                    scope: vscode.TaskScope.Workspace,
                    showBuildStatus: "progress",
                },
                instance(toolchain),
                { BAZ: "2" }
            );
            assert.equal(task.definition.showBuildStatus, "progress");
        });

        test("include disableTaskQueue", () => {
            envConfig.setValue({ FOO: "1" });
            const task = createSwiftTask(
                ["--help"],
                "help",
                {
                    cwd: workspaceFolder.uri,
                    scope: vscode.TaskScope.Workspace,
                    disableTaskQueue: true,
                },
                instance(toolchain),
                { BAZ: "2" }
            );
            assert.equal(task.definition.disableTaskQueue, true);
        });

        test("include dontTriggerTestDiscovery", () => {
            envConfig.setValue({ FOO: "1" });
            const task = createSwiftTask(
                ["--help"],
                "help",
                {
                    cwd: workspaceFolder.uri,
                    scope: vscode.TaskScope.Workspace,
                    dontTriggerTestDiscovery: true,
                },
                instance(toolchain),
                { BAZ: "2" }
            );
            assert.equal(task.definition.dontTriggerTestDiscovery, true);
        });
    });

    suite("resolveTask", () => {
        test("uses SwiftExecution", () => {
            const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift",
                    args: [],
                },
                workspaceFolder,
                "run PackageExe",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            assert.equal(resolvedTask.execution instanceof SwiftExecution, true);
        });

        test("uses toolchain swift path", () => {
            const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift",
                    args: [],
                },
                workspaceFolder,
                "run PackageExe",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.equal(swiftExecution.command, "/path/to/bin/swift");
        });

        test("substitutes variables", () => {
            const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
            const task = new vscode.Task(
                {
                    type: "swift",
                    args: ["run", "PackageExe", "--", "${cwd}", "${userHome}"],
                },
                workspaceFolder,
                "run PackageExe",
                "swift"
            );
            const resolvedTask = taskProvider.resolveTask(
                task,
                new vscode.CancellationTokenSource().token
            );
            const swiftExecution = resolvedTask.execution as SwiftExecution;
            assert.deepEqual(swiftExecution.args, [
                "run",
                "PackageExe",
                "--",
                process.cwd(),
                os.homedir(),
            ]);
        });

        suite("Platform cwd", () => {
            test("includes macos cwd", () => {
                platformMock.setValue("darwin");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        cwd: workspaceFolder.uri.fsPath,
                        macos: {
                            cwd: `${workspaceFolder.uri.fsPath}/macos`,
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.cwd, `${workspaceFolder.uri.fsPath}/macos`);
            });

            test("includes linux cwd", () => {
                platformMock.setValue("linux");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        cwd: workspaceFolder.uri.fsPath,
                        linux: {
                            cwd: `${workspaceFolder.uri.fsPath}/linux`,
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.cwd, `${workspaceFolder.uri.fsPath}/linux`);
            });

            test("includes windows cwd", () => {
                platformMock.setValue("win32");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        cwd: workspaceFolder.uri.fsPath,
                        windows: {
                            cwd: `${workspaceFolder.uri.fsPath}/windows`,
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.cwd, `${workspaceFolder.uri.fsPath}/windows`);
            });

            test("fallback default cwd", () => {
                platformMock.setValue("darwin");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        cwd: workspaceFolder.uri.fsPath,
                        linux: {
                            cwd: `${workspaceFolder.uri.fsPath}/linux`,
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.cwd, workspaceFolder.uri.fsPath);
            });
        });

        suite("Platform env", () => {
            test("includes macos env", () => {
                platformMock.setValue("darwin");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        env: {
                            FOO: "bar",
                        },
                        macos: {
                            env: {
                                FOO: "baz",
                            },
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.env?.FOO, "baz");
            });

            test("includes linux env", () => {
                platformMock.setValue("linux");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        env: {
                            FOO: "bar",
                        },
                        linux: {
                            env: {
                                FOO: "baz",
                            },
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.env?.FOO, "baz");
            });

            test("includes windows env", () => {
                platformMock.setValue("win32");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        env: {
                            FOO: "bar",
                        },
                        windows: {
                            env: {
                                FOO: "baz",
                            },
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.env?.FOO, "baz");
            });

            test("fallback default env", () => {
                platformMock.setValue("darwin");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: [],
                        env: {
                            FOO: "bar",
                        },
                        linux: {
                            env: {
                                FOO: "baz",
                            },
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.equal(swiftExecution.options.env?.FOO, "bar");
            });
        });

        suite("Platform args", () => {
            test("includes macos args", () => {
                platformMock.setValue("darwin");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: ["run", "PackageExe"],
                        macos: {
                            args: ["run", "MacosPackageExe"],
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.deepEqual(swiftExecution.args, ["run", "MacosPackageExe"]);
            });

            test("includes linux args", () => {
                platformMock.setValue("linux");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: ["run", "PackageExe"],
                        linux: {
                            args: ["run", "LinuxPackageExe"],
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.deepEqual(swiftExecution.args, ["run", "LinuxPackageExe"]);
            });

            test("includes windows args", () => {
                platformMock.setValue("win32");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: ["run", "PackageExe"],
                        windows: {
                            args: ["run", "WinPackageExe"],
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.deepEqual(swiftExecution.args, ["run", "WinPackageExe"]);
            });

            test("fallback default args", () => {
                platformMock.setValue("darwin");
                const taskProvider = new SwiftTaskProvider(instance(workspaceContext));
                const task = new vscode.Task(
                    {
                        type: "swift",
                        args: ["run", "PackageExe"],
                        linux: {
                            args: ["run", "LinuxPackageExe"],
                        },
                    },
                    workspaceFolder,
                    "run PackageExe",
                    "swift"
                );
                const resolvedTask = taskProvider.resolveTask(
                    task,
                    new vscode.CancellationTokenSource().token
                );
                const swiftExecution = resolvedTask.execution as SwiftExecution;
                assert.deepEqual(swiftExecution.args, ["run", "PackageExe"]);
            });
        });
    });

    suite("getBuildAllTask", () => {
        const tasksMock = mockGlobalObject(vscode, "tasks");

        let folderContext: MockedObject<FolderContext>;
        let extensionTask: vscode.Task;
        let workspaceTask: vscode.Task;

        setup(() => {
            folderContext = mockObject<FolderContext>({
                workspaceContext: instance(workspaceContext),
                workspaceFolder: workspaceFolder,
                folder: workspaceFolder.uri,
                relativePath: "",
            });

            tasksMock.fetchTasks.resolves([]);

            extensionTask = createSwiftTask(
                ["build"],
                SwiftTaskProvider.buildAllName,
                {
                    cwd: workspaceFolder.uri,
                    scope: workspaceFolder,
                },
                instance(toolchain)
            );
            workspaceTask = createSwiftTask(
                ["build"],
                `swift: ${SwiftTaskProvider.buildAllName}`,
                {
                    cwd: workspaceFolder.uri,
                    scope: workspaceFolder,
                },
                instance(toolchain)
            );
            workspaceTask.source = "Workspace"; // When comes from task.json
        });

        test("returns task provided by the extension", async () => {
            tasksMock.fetchTasks.resolves([extensionTask]);
            assert.strictEqual(extensionTask, await getBuildAllTask(instance(folderContext)));
        });

        test("returns workspace task, matched by name", async () => {
            tasksMock.fetchTasks.withArgs().resolves([workspaceTask]);
            tasksMock.fetchTasks.withArgs(match.object).returns(Promise.resolve([extensionTask]));
            assert.strictEqual(workspaceTask, await getBuildAllTask(instance(folderContext)));
        });

        test("returns workspace task, default build task", async () => {
            const defaultBuildTask = createSwiftTask(
                ["build"],
                `some weird task name`,
                {
                    cwd: workspaceFolder.uri,
                    scope: workspaceFolder,
                },
                instance(toolchain)
            );
            defaultBuildTask.source = "Workspace";
            defaultBuildTask.group = {
                id: vscode.TaskGroup.Build.id,
                isDefault: true,
            };
            tasksMock.fetchTasks.resolves([defaultBuildTask, workspaceTask]);
            assert.strictEqual(defaultBuildTask, await getBuildAllTask(instance(folderContext)));
        });

        test("workspace task NOT default build task", async () => {
            const nonDefaultBuildTask = createSwiftTask(
                ["build"],
                `some weird task name`,
                {
                    cwd: workspaceFolder.uri,
                    scope: workspaceFolder,
                },
                instance(toolchain)
            );
            nonDefaultBuildTask.source = "Workspace";
            nonDefaultBuildTask.group = vscode.TaskGroup.Build;
            tasksMock.fetchTasks.withArgs().resolves([nonDefaultBuildTask]);
            tasksMock.fetchTasks.withArgs(match.object).returns(Promise.resolve([extensionTask]));
            assert.strictEqual(extensionTask, await getBuildAllTask(instance(folderContext)));
        });
    });
});
