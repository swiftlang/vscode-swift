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

import configuration from "@src/configuration";
import { SourceKitLanguageClient } from "@src/sourcekit-lsp/client/SourceKitLanguageClient";
import { BuildFlags } from "@src/toolchain/BuildFlags";
import { SwiftToolchain } from "@src/toolchain/toolchain";

import { instance, mockFn, mockGlobalValue, mockObject } from "../../MockUtils";

suite("SourceKitLanguageClient Test Suite", () => {
    suite("serverInvocation", () => {
        const lspConfig = mockGlobalValue(configuration, "lsp");
        const buildArgsConfig = mockGlobalValue(configuration, "buildArguments");
        let toolchain: SwiftToolchain;

        const expectedArgs = [
            "--experimental-feature",
            "on-type-formatting",
            "--sdk-flag",
            "--target-flag",
            "--scratch-path",
            "/scratch",
        ];

        function setServerPath(serverPath: string) {
            lspConfig.setValue(
                instance(
                    mockObject<typeof configuration.lsp>({
                        serverPath,
                        serverArguments: ["--experimental-feature", "on-type-formatting"],
                    })
                )
            );
        }

        setup(() => {
            buildArgsConfig.setValue(["--scratch-path", "/scratch", "--verbose"]);
            toolchain = instance(
                mockObject<SwiftToolchain>({
                    buildFlags: instance(
                        mockObject<BuildFlags>({
                            swiftDriverSDKFlags: mockFn(s => s.returns(["--sdk-flag"])),
                            swiftDriverTargetFlags: mockFn(s => s.returns(["--target-flag"])),
                            buildPathFlags: mockFn(s => s.returns([])),
                        })
                    ),
                    getToolchainInvocation: mockFn(s =>
                        s.callsFake((executable: string, args: string[]) => ({
                            command: `/toolchain/usr/bin/${executable}`,
                            args,
                        }))
                    ),
                })
            );
        });

        test("runs the toolchain's sourcekit-lsp with the server arguments and build settings", () => {
            setServerPath("");

            expect(SourceKitLanguageClient.serverInvocation(toolchain)).to.deep.equal({
                command: "/toolchain/usr/bin/sourcekit-lsp",
                args: expectedArgs,
            });
        });

        test("runs a custom serverPath with the server arguments and build settings", () => {
            setServerPath("/custom/sourcekit-lsp");

            expect(SourceKitLanguageClient.serverInvocation(toolchain)).to.deep.equal({
                command: "/custom/sourcekit-lsp",
                args: expectedArgs,
            });
        });
    });
});
