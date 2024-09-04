import * as assert from "assert";
import { getLldbProcess } from "../../../src/debugger/lldb";
import { SwiftToolchain } from "../../../src/toolchain/toolchain";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { SwiftOutputChannel } from "../../../src/ui/SwiftOutputChannel";

suite("getLldbProcess Contract Test Suite", () => {
    test("happy path, make sure lldb call returns proper output", async () => {
        const toolchain = await SwiftToolchain.create();
        const workspaceContext = await WorkspaceContext.create(
            new SwiftOutputChannel("Swift"),
            toolchain
        );
        assert.notStrictEqual(await getLldbProcess(workspaceContext), []);
    });
});
