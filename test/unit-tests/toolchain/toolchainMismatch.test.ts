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
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import {
    detectSwiftlyXcodeToolchainMismatch,
    maybeShowSwiftlyXcodeToolchainMismatchWarning,
} from "@src/toolchain/toolchainMismatch";

import { instance, mockGlobalObject, mockGlobalValue, mockObject } from "../../MockUtils";

suite("Toolchain Mismatch Unit Test Suite", () => {
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    const mockedVSCodeCommands = mockGlobalObject(vscode, "commands");
    const mockedVSCodeEnv = mockGlobalObject(vscode, "env");
    const mockedPlatform = mockGlobalValue(process, "platform");

    setup(() => {
        mockedPlatform.setValue("darwin");
    });

    test("detects mismatch from mixed Swiftly and Xcode paths plus compiler mismatch signal", () => {
        const output = `
error: compile command failed
/Users/me/.swiftly/toolchains/6.2.0/usr/bin/swift
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
error: module was created by a different version of the compiler
`;

        expect(
            detectSwiftlyXcodeToolchainMismatch(output, {
                platform: "darwin",
            })
        ).to.equal(true);
    });

    test("detects mismatch when using swiftly manager even if swiftly path isn't present in output", () => {
        const output = `
error: failed to build module 'Foo'
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
`;

        expect(
            detectSwiftlyXcodeToolchainMismatch(output, {
                platform: "darwin",
                toolchainManager: "swiftly",
            })
        ).to.equal(true);
    });

    test("does not detect mismatch when compatibility signal is missing", () => {
        const output = `
/Users/me/.swiftly/toolchains/6.2.0/usr/bin/swift
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
`;

        expect(
            detectSwiftlyXcodeToolchainMismatch(output, {
                platform: "darwin",
            })
        ).to.equal(false);
    });

    test("does not detect mismatch on non-macos platforms", () => {
        const output = `
/Users/me/.swiftly/toolchains/6.2.0/usr/bin/swift
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
error: module was created by a different version of the compiler
`;

        expect(
            detectSwiftlyXcodeToolchainMismatch(output, {
                platform: "linux",
                toolchainManager: "swiftly",
            })
        ).to.equal(false);
    });

    test("detects mismatch from differing swiftlang versions when both toolchain paths are present", () => {
        const output = `
error: emit-module command failed with exit code 1
/Users/me/.swiftly/toolchains/6.2.0/usr/bin/swift
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
Apple Swift version 6.2 (swiftlang-6.2.0.17.14 clang-1700.3.17.1)
Apple Swift version 6.1.2 (swiftlang-6.1.2.1.2 clang-1700.0.13.3)
`;

        expect(
            detectSwiftlyXcodeToolchainMismatch(output, {
                platform: "darwin",
            })
        ).to.equal(true);
    });

    test("detects mismatch from swift-frontend failure signal", () => {
        const output = `
error: swift-frontend command failed due to signal 6
/Users/me/.swiftly/toolchains/6.2.0/usr/bin/swift
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
`;

        expect(
            detectSwiftlyXcodeToolchainMismatch(output, {
                platform: "darwin",
                toolchainManager: "swiftly",
            })
        ).to.equal(true);
    });

    test("shows warning and can route user to toolchain selection", async () => {
        mockedVSCodeWindow.showWarningMessage.resolves("Select Toolchain" as any);

        const result = maybeShowSwiftlyXcodeToolchainMismatchWarning(
            `
error: failed to build module 'Foo'
/Users/me/.swiftly/toolchains/6.2.0/usr/bin/swift
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
error: module was created by a different version of the compiler
`,
            instance(
                mockObject<FolderContext>({
                    folder: vscode.Uri.file("/tmp/swift-package-mismatch-a"),
                    toolchain: {
                        manager: "swiftly",
                    } as any,
                })
            )
        );

        expect(result).to.equal(true);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnce;
        expect(mockedVSCodeCommands.executeCommand).to.have.been.calledOnceWithExactly(
            "swift.selectToolchain"
        );
    });

    test("shows warning and can route user to documentation", async () => {
        mockedVSCodeWindow.showWarningMessage.resolves("Open Documentation" as any);

        const result = maybeShowSwiftlyXcodeToolchainMismatchWarning(
            `
error: cannot load underlying module
/Users/me/.swiftly/toolchains/6.2.0/usr/bin/swift
/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift-frontend
`,
            instance(
                mockObject<FolderContext>({
                    folder: vscode.Uri.file("/tmp/swift-package-mismatch-b"),
                    toolchain: {
                        manager: "swiftly",
                    } as any,
                })
            )
        );

        expect(result).to.equal(true);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        expect(mockedVSCodeEnv.openExternal).to.have.been.calledOnce;
    });

    test("does not show warning when mismatch is not detected", () => {
        const result = maybeShowSwiftlyXcodeToolchainMismatchWarning(
            "error: no such module 'Foo'",
            instance(
                mockObject<FolderContext>({
                    folder: vscode.Uri.file("/tmp/swift-package-mismatch-c"),
                    toolchain: {
                        manager: "unknown",
                    } as any,
                })
            )
        );
        expect(result).to.equal(false);
        expect(mockedVSCodeWindow.showWarningMessage).to.not.have.been.called;
    });
});
