//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import { testAssetWorkspaceFolder } from "../fixtures";
import { FolderEvent, SwiftExtensionContext, WorkspaceContext } from "../../WorkspaceContext";

class TestExtensionContext implements SwiftExtensionContext {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly subscriptions: { dispose(): any }[] = [];
}

suite("WorkspaceContext Test Suite", () => {
    test("Add/Remove", async () => {
        let count = 0;
        const workspaceContext = new WorkspaceContext(new TestExtensionContext());
        workspaceContext.observeFolders((folder, operation) => {
            assert(folder !== null);
            assert.strictEqual(folder.swiftPackage.name, "package1");
            switch (operation) {
                case FolderEvent.add:
                    count++;
                    break;
                case FolderEvent.remove:
                    count--;
                    break;
            }
        });
        const packageFolder = testAssetWorkspaceFolder("package1");
        await workspaceContext.addWorkspaceFolder(packageFolder);
        await workspaceContext.removeFolder(packageFolder);
        assert.strictEqual(count, 0);
    }).timeout(5000);
});
