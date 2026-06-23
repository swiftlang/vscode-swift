//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";

import { SwiftPackage } from "@src/SwiftPackage";
import configuration from "@src/configuration";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as utilities from "@src/utilities/utilities";

import { instance, mockGlobalFunction, mockGlobalValue, mockObject } from "../MockUtils";

suite("SwiftPackage Suite", () => {
    suite("loadSwiftPlugins", () => {
        // Pins the security guarantee that a pre-staged forged
        // .build/workspace-state.json must not be authoritative once SwiftPM
        // has been invoked. `swift package plugin --list` regenerates the
        // file, so loadSwiftPlugins MUST refresh in-memory state from disk
        // afterwards. See TrustedPlugins.ts for the URL-keyed allowlist that
        // depends on this guarantee.
        const readFileMock = mockGlobalFunction(fs, "readFile");
        const execSwiftMock = mockGlobalFunction(utilities, "execSwift");

        test("re-reads workspace-state.json after running SwiftPM", async () => {
            // SwiftPM regenerates workspace-state.json as a side effect of
            // `swift package plugin --list`. The post-load workspaceState
            // must reflect the regenerated file, not whatever was on disk
            // before. That refresh is how the forgery vector is closed. The
            // concurrency / atomic-assignment guarantees that `plugins` and
            // `workspaceState` come from the same resolve are pinned by the
            // next two tests.
            const initialWs = JSON.stringify({ version: 6, object: { dependencies: [] } });
            const refreshedWs = JSON.stringify({
                version: 6,
                object: {
                    dependencies: [
                        {
                            packageRef: {
                                identity: "swift-docc-plugin",
                                kind: "remoteSourceControl",
                                location: "https://github.com/swiftlang/swift-docc-plugin",
                                name: "SwiftDocCPlugin",
                            },
                            state: { name: "checkout" },
                            subpath: "swift-docc-plugin",
                        },
                    ],
                },
            });
            let workspaceStateReadCount = 0;
            readFileMock.callsFake((async (filePath: unknown) => {
                const p = String(filePath);
                if (p.endsWith("Package.resolved")) {
                    throw new Error("ENOENT");
                }
                workspaceStateReadCount++;
                return workspaceStateReadCount === 1 ? initialWs : refreshedWs;
            }) as typeof fs.readFile);
            execSwiftMock.resolves({ stdout: "", stderr: "" });

            const pkg = await SwiftPackage.create(vscode.Uri.file("/tmp/swift-package-test"));
            expect(pkg.workspaceState).to.deep.equal(JSON.parse(initialWs));

            await pkg.loadSwiftPlugins(
                instance(mockObject<SwiftToolchain>({})),
                instance(mockObject<SwiftLogger>({}))
            );

            expect(pkg.workspaceState).to.deep.equal(JSON.parse(refreshedWs));
            expect(workspaceStateReadCount).to.be.greaterThanOrEqual(2);
        });

        test("serializes concurrent invocations so plugins and workspaceState always come from the same SwiftPM resolve", async () => {
            // Without serialization, two concurrent loadSwiftPlugins calls
            // can interleave and leave `plugins` paired with a stale
            // `workspaceState` from a different resolve, breaking
            // trusted-plugin URL checks.
            readFileMock.rejects(new Error("ENOENT"));

            const events: string[] = [];
            let resolveFirstExec: () => void = () => {};
            const firstExecBlocked = new Promise<void>(r => {
                resolveFirstExec = r;
            });
            execSwiftMock.callsFake((async () => {
                const callId = execSwiftMock.callCount;
                events.push(`exec-${callId}-start`);
                if (callId === 1) {
                    await firstExecBlocked;
                }
                events.push(`exec-${callId}-end`);
                return { stdout: "", stderr: "" };
            }) as typeof utilities.execSwift);

            const pkg = await SwiftPackage.create(vscode.Uri.file("/tmp/swift-package-test"));
            const toolchain = instance(mockObject<SwiftToolchain>({}));
            const logger = instance(mockObject<SwiftLogger>({}));

            const callA = pkg.loadSwiftPlugins(toolchain, logger);
            const callB = pkg.loadSwiftPlugins(toolchain, logger);

            // Let microtasks settle. Only the first call's execSwift should
            // be in-flight; the second must wait its turn.
            await new Promise(r => setImmediate(r));
            expect(events).to.deep.equal(["exec-1-start"]);

            resolveFirstExec();
            await Promise.all([callA, callB]);

            expect(events).to.deep.equal([
                "exec-1-start",
                "exec-1-end",
                "exec-2-start",
                "exec-2-end",
            ]);
        });

        test("assigns plugins and workspaceState atomically so observers never see a partial-update pair", async () => {
            // Pins the TOCTOU fix: between `loadPlugins` and
            // `loadWorkspaceState` an observer (e.g. provideTasks) must not
            // see new plugins paired with a still-stale workspaceState.
            // Trusted-plugin URL checks consult both fields together; a
            // partial-update window would let a forged on-disk
            // workspace-state.json grant elevation against newly-loaded
            // plugins.
            const initialWs = JSON.stringify({
                version: 6,
                object: { dependencies: [] },
            });
            const refreshedWs = JSON.stringify({
                version: 6,
                object: {
                    dependencies: [
                        {
                            packageRef: {
                                identity: "swift-docc-plugin",
                                kind: "remoteSourceControl",
                                location: "https://github.com/swiftlang/swift-docc-plugin",
                                name: "SwiftDocCPlugin",
                            },
                            state: { name: "checkout" },
                            subpath: "swift-docc-plugin",
                        },
                    ],
                },
            });

            let resolveRefreshRead: (contents: string) => void = () => {};
            let workspaceStateReadCount = 0;
            readFileMock.callsFake((async (filePath: unknown) => {
                const p = String(filePath);
                if (p.endsWith("Package.resolved")) {
                    throw new Error("ENOENT");
                }
                if (p.endsWith("workspace-state.json")) {
                    workspaceStateReadCount++;
                    if (workspaceStateReadCount === 1) {
                        return initialWs;
                    }
                    return new Promise<string>(r => {
                        resolveRefreshRead = r;
                    });
                }
                throw new Error(`unexpected: ${p}`);
            }) as typeof fs.readFile);
            execSwiftMock.resolves({ stdout: "", stderr: "" });

            const pkg = await SwiftPackage.create(vscode.Uri.file("/tmp/swift-package-test"));
            const initialPlugins = pkg.plugins;
            const initialWorkspaceState = pkg.workspaceState;

            const callPromise = pkg.loadSwiftPlugins(
                instance(mockObject<SwiftToolchain>({})),
                instance(mockObject<SwiftLogger>({}))
            );

            // Let microtasks settle so loadPlugins has completed and we are
            // suspended awaiting the workspace-state refresh.
            await new Promise(r => setImmediate(r));
            await new Promise(r => setImmediate(r));

            // Critical: neither field has been updated yet. They MUST move
            // together, never independently.
            expect(pkg.plugins).to.equal(initialPlugins);
            expect(pkg.workspaceState).to.equal(initialWorkspaceState);

            resolveRefreshRead(refreshedWs);
            await callPromise;

            expect(pkg.workspaceState).to.deep.equal(JSON.parse(refreshedWs));
        });
    });

    // `swift package plugin --list` regenerates workspace-state.json as a side
    // effect, and loadSwiftPlugins reads it back immediately afterwards. The
    // regeneration (write) and the read must resolve the SAME scratch
    // directory, otherwise the in-memory workspaceState reflects a stale file
    // left on disk rather than the one SwiftPM just wrote. `swift.buildArguments`
    // can relocate the scratch directory via `--scratch-path`, so that
    // redirection has to reach the `--list` invocation as well as the read.
    suite("loadSwiftPlugins build directory consistency", () => {
        const readFileMock = mockGlobalFunction(fs, "readFile");
        const execSwiftMock = mockGlobalFunction(utilities, "execSwift");
        const buildArgsConfig = mockGlobalValue(configuration, "buildArguments");
        const buildPathConfig = mockGlobalValue(configuration, "buildPath");
        const packageArgsConfig = mockGlobalValue(configuration, "packageArguments");

        const workspacePath = "/tmp/swift-package-test";
        const scratchDir = path.join(workspacePath, "custom-build");
        const scratchStatePath = path.join(scratchDir, "workspace-state.json");

        // A stale workspace-state.json already sitting in the relocated scratch
        // directory before SwiftPM runs.
        const staleState = JSON.stringify({
            version: 7,
            object: {
                artifacts: [],
                dependencies: [
                    {
                        subpath: "some-dependency",
                        packageRef: {
                            identity: "some-dependency",
                            kind: "remoteSourceControl",
                            name: "SomeDependency",
                            location: "https://github.com/example/some-dependency",
                        },
                        state: { name: "sourceControlCheckout" },
                    },
                ],
                prebuilts: [],
            },
        });
        // What `swift package plugin --list` writes when it regenerates the file.
        const regeneratedState = JSON.stringify({
            version: 7,
            object: { artifacts: [], dependencies: [], prebuilts: [] },
        });

        test("reads workspace-state.json from the directory `plugin --list` regenerated when swift.buildArguments redirects the scratch path", async () => {
            buildArgsConfig.setValue(["--scratch-path", "custom-build"]);
            buildPathConfig.setValue("");
            packageArgsConfig.setValue([]);

            // In-memory disk seeded with the stale file in the relocated dir.
            const disk = new Map<string, string>([[scratchStatePath, staleState]]);

            readFileMock.callsFake((async (filePath: unknown) => {
                const p = String(filePath);
                if (p.endsWith("Package.resolved")) {
                    throw new Error("ENOENT");
                }
                const contents = disk.get(p);
                if (contents === undefined) {
                    throw new Error(`ENOENT: ${p}`);
                }
                return contents;
            }) as typeof fs.readFile);

            let listScratchPath: string | undefined;
            execSwiftMock.callsFake((async (args: string[]) => {
                // Model SwiftPM: `plugin --list` regenerates workspace-state.json
                // in whatever scratch directory it is told to use, defaulting to
                // `.build` when none is supplied.
                listScratchPath = BuildFlags.lastFlagValue(args, "--scratch-path");
                const dir = listScratchPath ?? path.join(workspacePath, ".build");
                disk.set(path.join(dir, "workspace-state.json"), regeneratedState);
                return { stdout: "", stderr: "" };
            }) as typeof utilities.execSwift);

            const pkg = await SwiftPackage.create(vscode.Uri.file(workspacePath));
            // Baseline: the stale file is what is on disk before SwiftPM runs.
            expect(pkg.workspaceState).to.deep.equal(JSON.parse(staleState));

            await pkg.loadSwiftPlugins(
                instance(mockObject<SwiftToolchain>({})),
                instance(mockObject<SwiftLogger>({}))
            );

            // `--list` ran against the relocated scratch directory...
            expect(listScratchPath).to.equalPath(scratchDir);
            // ...so the file it regenerated is the one loadSwiftPlugins read back,
            // not the stale copy that was sitting there beforehand.
            expect(disk.get(scratchStatePath)).to.equal(regeneratedState);
            expect(pkg.workspaceState).to.deep.equal(JSON.parse(regeneratedState));
        });
    });
});
