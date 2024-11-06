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
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";

suite("SwiftOutputChannel", function () {
    let channel: SwiftOutputChannel;
    const channels: SwiftOutputChannel[] = [];
    setup(function () {
        const channelName = `SwiftOutputChannel Tests ${this.currentTest?.id ?? "<unknown test>"}`;
        channel = new SwiftOutputChannel(channelName, false, 3);
        channels.push(channel);
    });

    suiteTeardown(async function () {
        // Output channels are added to their disposable store asynchronously, which leads
        // to warnings in the console if we dispose of them immediately after the test.
        // https://github.com/microsoft/vscode/blob/1f8fd7adeff6c113f9226787bdf4f417e6bdfb11/src/vs/workbench/api/common/extHostOutput.ts#L150
        // As a workaround, we wait for a short period of time before disposing of the channels
        await new Promise(resolve =>
            setTimeout(() => {
                channels.forEach(channel => channel.dispose());
                resolve(void 0);
            }, 50)
        );
    });

    test("Appends logs", () => {
        channel.append("a");
        channel.append("b");
        channel.append("c");
        assert.deepEqual(channel.logs, ["abc"]);
    });

    test("Appends lines", () => {
        channel.appendLine("a");
        channel.appendLine("b");
        channel.appendLine("c");
        assert.deepEqual(channel.logs, ["a", "b", "c"]);
    });

    test("Appends lines and rolls over", () => {
        channel.appendLine("a");
        channel.appendLine("b");
        channel.appendLine("c");
        channel.appendLine("d");
        assert.deepEqual(channel.logs, ["b", "c", "d"]);
    });

    test("Appends and rolls over", () => {
        channel.appendLine("a");
        channel.appendLine("b");
        channel.appendLine("c");
        channel.append("d");
        channel.appendLine("e");
        assert.deepEqual(channel.logs, ["b", "cd", "e"]);
    });

    test("Appends after rolling over", () => {
        channel.appendLine("a");
        channel.appendLine("b");
        channel.appendLine("c");
        channel.appendLine("d");
        channel.append("e");
        channel.appendLine("f");
        assert.deepEqual(channel.logs, ["c", "de", "f"]);
    });

    test("Replaces", () => {
        channel.appendLine("a");
        channel.appendLine("b");
        channel.appendLine("c");
        channel.appendLine("d");
        channel.replace("e");
        assert.deepEqual(channel.logs, ["e"]);
    });

    test("AppendLine after append terminates appending line", () => {
        channel.append("a");
        channel.append("b");
        channel.appendLine("c");
        assert.deepEqual(channel.logs, ["ab", "c"]);
    });
});
