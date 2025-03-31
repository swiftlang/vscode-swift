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

import { expect } from "chai";
import { ToolchainVersion } from "../../../src/toolchain/ToolchainVersion";

suite("ToolchainVersion Unit Test Suite", () => {
    test("Parses snapshot", () => {
        const version = ToolchainVersion.parse("main-snapshot-2025-03-28");
        expect(version.identifier).to.equal("swift-DEVELOPMENT-SNAPSHOT-2025-03-28-a");
    });

    test("Parses release snapshot", () => {
        const version = ToolchainVersion.parse("6.0-snapshot-2025-03-28");
        expect(version.identifier).to.equal("swift-6.0-DEVELOPMENT-SNAPSHOT-2025-03-28-a");
    });

    test("Parses stable", () => {
        const version = ToolchainVersion.parse("6.0.3");
        expect(version.identifier).to.equal("swift-6.0.3-RELEASE");
    });
});
