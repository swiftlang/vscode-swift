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
import * as vscode from "vscode";

import { OutputChannelTransport } from "@src/logging/OutputChannelTransport";

import { MockedObject, mockFn, mockObject } from "../../MockUtils";

suite("OutputChannelTransport Suite", () => {
    function createMockChannel(): MockedObject<vscode.OutputChannel> {
        return mockObject<vscode.OutputChannel>({
            append: mockFn(s => s.returns(undefined)),
            appendLine: mockFn(s => s.returns(undefined)),
        });
    }

    test("does not throw when output channel is undefined", done => {
        const transport = new OutputChannelTransport(undefined as unknown as vscode.OutputChannel);
        transport.log({ message: "test", [Symbol.for("message")]: "test" }, () => {
            done();
        });
    });

    test("calls append on the output channel when append is true", done => {
        const mockChannel = createMockChannel();

        const transport = new OutputChannelTransport(
            mockChannel as unknown as vscode.OutputChannel
        );

        transport.log(
            { message: "continuation", append: true, [Symbol.for("message")]: "formatted" },
            () => {
                expect(mockChannel.append).to.have.been.calledOnce;
                done();
            }
        );
    });

    test("calls appendLine on the output channel when append is falsy", done => {
        const mockChannel = createMockChannel();

        const transport = new OutputChannelTransport(
            mockChannel as unknown as vscode.OutputChannel
        );
        transport.log({ message: "hello", [Symbol.for("message")]: "formatted" }, () => {
            expect(mockChannel.appendLine).to.have.been.calledOnceWith("formatted");
            done();
        });
    });
});
