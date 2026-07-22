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

import { llvmCovObjectArguments } from "@src/coverage/LcovResults";

suite("LcovResults Unit Tests", () => {
    suite("llvmCovObjectArguments", () => {
        test("returns no arguments when there are no binaries", () => {
            expect(llvmCovObjectArguments([])).to.deep.equal([]);
        });

        test("passes a single binary as a bare positional argument", () => {
            expect(llvmCovObjectArguments(["/bin/AppTests"])).to.deep.equal(["/bin/AppTests"]);
        });

        test("prefixes every binary after the first with -object", () => {
            // llvm-cov export treats only the first positional argument as an
            // instrumented binary; subsequent binaries must be introduced with
            // -object or they are silently interpreted as source-file filters.
            expect(
                llvmCovObjectArguments([
                    "/bin/S3StoreTests",
                    "/bin/AuthenticationTests",
                    "/bin/AppTests",
                ])
            ).to.deep.equal([
                "/bin/S3StoreTests",
                "-object",
                "/bin/AuthenticationTests",
                "-object",
                "/bin/AppTests",
            ]);
        });
    });
});
