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
import * as sinon from "sinon";
import * as vscode from "vscode";

import { LoggingDebugAdapterTracker } from "@src/debugger/logTracker";
import { SwiftLogger } from "@src/logging/SwiftLogger";

import { MockedObject, instance, mockFn, mockObject } from "../../MockUtils";

suite("LoggingDebugAdapterTracker Unit Test Suite", () => {
    let logger: MockedObject<SwiftLogger>;
    let session: vscode.DebugSession;

    setup(() => {
        logger = mockObject<SwiftLogger>({ error: mockFn() });
        session = { id: "session-1" } as vscode.DebugSession;
    });

    function exitedEvent(exitCode: number | undefined) {
        return {
            seq: 0,
            type: "event",
            event: "exited",
            body: { exitCode },
        };
    }

    test("Forwards a non-zero exit code to the exit handler", () => {
        const tracker = new LoggingDebugAdapterTracker(session.id);
        const exitHandler = sinon.stub();
        LoggingDebugAdapterTracker.setDebugSessionCallback(
            session,
            instance(logger),
            sinon.stub(),
            exitHandler
        );

        tracker.onDidSendMessage(exitedEvent(9));

        expect(exitHandler).to.have.been.calledOnceWithExactly(9);
    });

    test("Forwards a zero exit code to the exit handler", () => {
        const tracker = new LoggingDebugAdapterTracker(session.id);
        const exitHandler = sinon.stub();
        LoggingDebugAdapterTracker.setDebugSessionCallback(
            session,
            instance(logger),
            sinon.stub(),
            exitHandler
        );

        tracker.onDidSendMessage(exitedEvent(0));

        expect(exitHandler).to.have.been.calledOnceWithExactly(0);
    });

    test("Replays a buffered zero exit code when the callback is set after exit", () => {
        const tracker = new LoggingDebugAdapterTracker(session.id);
        // Exit arrives before the callback has been registered.
        tracker.onDidSendMessage(exitedEvent(0));

        const exitHandler = sinon.stub();
        LoggingDebugAdapterTracker.setDebugSessionCallback(
            session,
            instance(logger),
            sinon.stub(),
            exitHandler
        );

        expect(exitHandler).to.have.been.calledOnceWithExactly(0);
    });

    test("Does not forward an exit when no exit code is present", () => {
        const tracker = new LoggingDebugAdapterTracker(session.id);
        const exitHandler = sinon.stub();
        LoggingDebugAdapterTracker.setDebugSessionCallback(
            session,
            instance(logger),
            sinon.stub(),
            exitHandler
        );

        tracker.onDidSendMessage(exitedEvent(undefined));

        expect(exitHandler).to.not.have.been.called;
    });
});
