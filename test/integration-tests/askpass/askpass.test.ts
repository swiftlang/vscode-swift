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
import { match } from "sinon";
import * as vscode from "vscode";

import { withAskpassServer } from "@src/askpass/askpass-server";
import { execFile } from "@src/utilities/utilities";

import { mockGlobalObject } from "../../MockUtils";
import { assetPath, distPath } from "../../fixtures";

suite("Askpass Test Suite", () => {
    const mockedWindow = mockGlobalObject(vscode, "window");
    const askpassMain = distPath("src/askpass/askpass-main.js");
    const askpassScript = assetPath("swift_askpass.sh");

    setup(function () {
        // The shell script we use won't work on Windows
        if (!["darwin", "linux"].includes(process.platform)) {
            this.skip();
        }
    });

    test("should prompt the user to enter their password", async () => {
        mockedWindow.showInputBox.resolves("super secret password");

        const output = await withAskpassServer(async (nonce, port) => {
            return await execFile(askpassScript, [], {
                env: {
                    ...process.env,
                    VSCODE_SWIFT_ASKPASS_NODE: process.execPath,
                    VSCODE_SWIFT_ASKPASS_MAIN: askpassMain,
                    VSCODE_SWIFT_ASKPASS_NONCE: nonce,
                    VSCODE_SWIFT_ASKPASS_PORT: port.toString(10),
                },
            });
        });

        expect(output.stdout.trim()).to.equal("super secret password");
    });

    test("should allow the user to cancel the password input", async () => {
        mockedWindow.showInputBox.resolves(undefined);

        const askpassPromise = withAskpassServer(async (nonce, port) => {
            return await execFile(askpassScript, [], {
                env: {
                    ...process.env,
                    VSCODE_SWIFT_ASKPASS_NODE: process.execPath,
                    VSCODE_SWIFT_ASKPASS_MAIN: askpassMain,
                    VSCODE_SWIFT_ASKPASS_NONCE: nonce,
                    VSCODE_SWIFT_ASKPASS_PORT: port.toString(10),
                },
            });
        });

        await expect(askpassPromise).to.eventually.be.rejected;
    });

    test("should reject requests with an invalid nonce", async () => {
        mockedWindow.showInputBox.resolves("super secret password");

        const askpassPromise = withAskpassServer(async (_nonce, port) => {
            return await execFile(askpassScript, [], {
                env: {
                    ...process.env,
                    VSCODE_SWIFT_ASKPASS_NODE: process.execPath,
                    VSCODE_SWIFT_ASKPASS_MAIN: askpassMain,
                    VSCODE_SWIFT_ASKPASS_NONCE: "invalid nonce",
                    VSCODE_SWIFT_ASKPASS_PORT: port.toString(10),
                },
            });
        });

        await expect(askpassPromise).to.eventually.be.rejected;
    });

    test("should be able to control the prompt title", async () => {
        mockedWindow.showInputBox.resolves("super secret password");

        await withAskpassServer(
            async (nonce, port) => {
                return await execFile(askpassScript, [], {
                    env: {
                        ...process.env,
                        VSCODE_SWIFT_ASKPASS_NODE: process.execPath,
                        VSCODE_SWIFT_ASKPASS_MAIN: askpassMain,
                        VSCODE_SWIFT_ASKPASS_NONCE: nonce,
                        VSCODE_SWIFT_ASKPASS_PORT: port.toString(10),
                    },
                });
            },
            { title: "An Amazing Title" }
        );

        expect(mockedWindow.showInputBox).to.have.been.calledWith(
            match.has("title", "An Amazing Title")
        );
    });
});
