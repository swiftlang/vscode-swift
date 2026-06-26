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
import * as child_process from "child_process";
import { EventEmitter } from "events";

import { ReadOnlySwiftProcess } from "@src/tasks/SwiftProcess";

import { mockGlobalModule } from "../../MockUtils";

suite("ReadOnlySwiftProcess", () => {
    const childProcessMock = mockGlobalModule(child_process);

    function fakeChildProcess(): child_process.ChildProcessWithoutNullStreams {
        const proc = new EventEmitter() as unknown as child_process.ChildProcessWithoutNullStreams;
        (proc as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
        (proc as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
        return proc;
    }

    test("resets safe.bareRepository=explicit to all in the spawned environment", () => {
        childProcessMock.spawn.returns(fakeChildProcess());

        new ReadOnlySwiftProcess("swift", ["package", "resolve"], {
            env: {
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "safe.bareRepository",
                GIT_CONFIG_VALUE_0: "explicit",
            },
        }).spawn();

        expect(childProcessMock.spawn).to.have.been.calledOnce;
        const spawnedEnv = childProcessMock.spawn.firstCall.args[2]?.env;
        expect(spawnedEnv).to.include({ GIT_CONFIG_VALUE_0: "all" });
    });

    test("leaves the environment untouched when safe.bareRepository is not explicit", () => {
        childProcessMock.spawn.returns(fakeChildProcess());

        new ReadOnlySwiftProcess("swift", ["package", "resolve"], {
            env: {
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "core.autocrlf",
                GIT_CONFIG_VALUE_0: "false",
            },
        }).spawn();

        const spawnedEnv = childProcessMock.spawn.firstCall.args[2]?.env;
        expect(spawnedEnv).to.include({ GIT_CONFIG_VALUE_0: "false" });
    });
});
