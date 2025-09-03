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

import { beforeEach, afterEach } from "mocha";
import { expect } from "chai";
import * as sinon from "sinon";
import { findBinaryPath } from "@src/utilities/shell";
import * as utilities from "@src/utilities/utilities";

suite("Shell Unit Test Suite", () => {
    let execFileStub: sinon.SinonStub;

    beforeEach(() => {
        execFileStub = sinon.stub(utilities, "execFile");
    });

    afterEach(() => {
        sinon.restore();
    });

    suite("findBinaryPath", () => {
        test("returns the path to a binary in the PATH", async () => {
            execFileStub.resolves({
                stdout: "node is /usr/local/bin/node\n",
                stderr: "",
            });

            const binaryPath = await findBinaryPath("node");
            expect(binaryPath).to.equal("/usr/local/bin/node");
            expect(execFileStub).to.have.been.calledWith("/bin/sh", [
                "-c",
                "LC_MESSAGES=C type node",
            ]);
        });

        test("throws for a non-existent binary", async () => {
            execFileStub.resolves({
                stdout: "",
                stderr: "sh: type: nonexistentbinary: not found\n",
            });

            try {
                await findBinaryPath("nonexistentbinary");
                expect.fail("Expected an error to be thrown for a non-existent binary");
            } catch (error) {
                expect(error).to.be.an("error");
                expect((error as Error).message).to.include("nonexistentbinary");
            }
        });
    });
});
