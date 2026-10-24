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
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { TestLibrary } from "@src/TestExplorer/TestRunner";
import { TestCoverage, llvmCovObjectArguments } from "@src/coverage/LcovResults";
import { SwiftLogger } from "@src/logging/SwiftLogger";
import { SwiftToolchain } from "@src/toolchain/toolchain";

import { MockedObject, instance, mockFn, mockObject } from "../../MockUtils";

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

    suite("TestCoverage", () => {
        let packageFolder: string;
        let logger: MockedObject<SwiftLogger>;
        let testRun: MockedObject<vscode.TestRun>;
        let coverage: TestCoverage;

        setup(async () => {
            packageFolder = await fs.mkdtemp(path.join(os.tmpdir(), "vscode-swift-coverage-"));
            const codecovFolder = path.join(packageFolder, ".build", "debug", "codecov");
            await fs.mkdir(codecovFolder, { recursive: true });
            await fs.writeFile(path.join(codecovFolder, "default.profdata"), "profdata");

            logger = mockObject<SwiftLogger>({
                trace: mockFn(),
                debug: mockFn(),
                error: mockFn(),
            });
            const toolchain = mockObject<SwiftToolchain>({
                getToolchainInvocation: mockFn(s =>
                    s.callsFake((tool: string, args: string[]) => ({
                        command: path.join(packageFolder, "missing-toolchain", tool),
                        args,
                    }))
                ),
            });
            const folderContext = mockObject<FolderContext>({
                name: "MyPackage",
                folder: vscode.Uri.file(packageFolder),
                logger: instance(logger),
                workspaceContext: instance(
                    mockObject<FolderContext["workspaceContext"]>({ logger: instance(logger) })
                ),
                toolchain: instance(toolchain),
            });
            testRun = mockObject<vscode.TestRun>({ addCoverage: mockFn() });
            coverage = new TestCoverage(instance(folderContext));
        });

        teardown(async () => {
            await fs.rm(packageFolder, { recursive: true, force: true });
        });

        test("logs an error when the coverage data cannot be processed", async () => {
            await coverage.captureCoverage(TestLibrary.xctest);
            await coverage.computeCoverage(instance(testRun));

            expect(testRun.addCoverage).to.not.have.been.called;
            expect(logger.error).to.have.been.calledOnce;
            const [message, meta] = logger.error.firstCall.args;
            expect(message).to.be.a("string").that.includes("Failed to compute code coverage");
            expect(message).to.include("llvm-profdata");
            expect(meta).to.deep.equal({ label: "MyPackage" });
        });
    });
});
