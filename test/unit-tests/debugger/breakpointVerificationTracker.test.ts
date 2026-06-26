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
import { DebugProtocol } from "@vscode/debugprotocol";
import { expect } from "chai";
import * as vscode from "vscode";

import { BreakpointVerificationTracker } from "@src/debugger/breakpointVerificationTracker";

import {
    MockedObject,
    instance,
    mockFn,
    mockGlobalFunction,
    mockGlobalValue,
    mockObject,
} from "../../MockUtils";

suite("BreakpointVerificationTracker Unit Test Suite", () => {
    const removeBreakpointsStub = mockGlobalFunction(vscode.debug, "removeBreakpoints");
    const addBreakpointsStub = mockGlobalFunction(vscode.debug, "addBreakpoints");
    const breakpointsValue = mockGlobalValue(vscode.debug, "breakpoints");

    let tracker: BreakpointVerificationTracker;
    let mockSession: MockedObject<vscode.DebugSession>;

    setup(() => {
        mockSession = mockObject<vscode.DebugSession>({
            getDebugProtocolBreakpoint: mockFn(),
        });
        tracker = new BreakpointVerificationTracker(instance(mockSession));
    });

    function stoppedEvent(reason: string): DebugProtocol.StoppedEvent {
        return {
            seq: 0,
            type: "event",
            event: "stopped",
            body: { reason, threadId: 1 },
        };
    }

    test("does not refresh when all breakpoints are verified", async () => {
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(9, 0))
        );
        breakpointsValue.setValue([bp]);
        mockSession.getDebugProtocolBreakpoint.resolves({ verified: true });

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(removeBreakpointsStub).to.not.have.been.called;
        expect(addBreakpointsStub).to.not.have.been.called;
    });

    test("refreshes only unverified breakpoints on first stop", async () => {
        const unverifiedBp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(9, 0))
        );
        const verifiedBp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(19, 0))
        );
        breakpointsValue.setValue([unverifiedBp, verifiedBp]);
        mockSession.getDebugProtocolBreakpoint.withArgs(unverifiedBp).resolves({ verified: false });
        mockSession.getDebugProtocolBreakpoint.withArgs(verifiedBp).resolves({ verified: true });

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(removeBreakpointsStub).to.have.been.calledOnceWithExactly([unverifiedBp]);
        expect(addBreakpointsStub).to.have.been.calledOnceWithExactly([unverifiedBp]);
    });

    test("only refreshes once even with multiple stopped events", async () => {
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(9, 0))
        );
        breakpointsValue.setValue([bp]);
        mockSession.getDebugProtocolBreakpoint.resolves({ verified: false });

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));
        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(removeBreakpointsStub).to.have.been.calledOnce;
        expect(addBreakpointsStub).to.have.been.calledOnce;
    });

    test("does not refresh before a stopped event", async () => {
        breakpointsValue.setValue([]);

        const processEvent: DebugProtocol.ProcessEvent = {
            seq: 0,
            type: "event",
            event: "process",
            body: { name: "test" },
        };
        await tracker.onDidSendMessageAsync(processEvent);

        expect(removeBreakpointsStub).to.not.have.been.called;
        expect(addBreakpointsStub).to.not.have.been.called;
    });

    test("skips breakpoints the adapter has no state for", async () => {
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(9, 0))
        );
        breakpointsValue.setValue([bp]);
        mockSession.getDebugProtocolBreakpoint.resolves(undefined);

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(removeBreakpointsStub).to.not.have.been.called;
        expect(addBreakpointsStub).to.not.have.been.called;
    });

    test("ignores non-source breakpoints", async () => {
        const fnBp = new vscode.FunctionBreakpoint("main");
        breakpointsValue.setValue([fnBp]);

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(mockSession.getDebugProtocolBreakpoint).to.not.have.been.called;
        expect(removeBreakpointsStub).to.not.have.been.called;
        expect(addBreakpointsStub).to.not.have.been.called;
    });

    test("ignores non-event messages", async () => {
        const requestMessage: DebugProtocol.Request = {
            seq: 1,
            type: "request",
            command: "continue",
        };
        const responseMessage: DebugProtocol.Response = {
            seq: 2,
            type: "response",
            request_seq: 1,
            command: "continue",
            success: true,
        };
        await tracker.onDidSendMessageAsync(requestMessage);
        await tracker.onDidSendMessageAsync(responseMessage);

        expect(removeBreakpointsStub).to.not.have.been.called;
        expect(addBreakpointsStub).to.not.have.been.called;
    });

    test("does not refresh on non-breakpoint stop reasons", async () => {
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(9, 0))
        );
        breakpointsValue.setValue([bp]);
        mockSession.getDebugProtocolBreakpoint.resolves({ verified: false });

        await tracker.onDidSendMessageAsync(stoppedEvent("step"));

        expect(removeBreakpointsStub).to.not.have.been.called;
        expect(addBreakpointsStub).to.not.have.been.called;
    });

    test("treats breakpoints without a verified field as unverified", async () => {
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(9, 0))
        );
        breakpointsValue.setValue([bp]);
        mockSession.getDebugProtocolBreakpoint.resolves({});

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(removeBreakpointsStub).to.have.been.calledOnce;
        expect(addBreakpointsStub).to.have.been.calledOnce;
    });

    test("treats breakpoints with a non-boolean verified field as unverified", async () => {
        const bp = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.file("/test.swift"), new vscode.Position(9, 0))
        );
        breakpointsValue.setValue([bp]);
        mockSession.getDebugProtocolBreakpoint.resolves({ verified: 1 });

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(removeBreakpointsStub).to.have.been.calledOnce;
        expect(addBreakpointsStub).to.have.been.calledOnce;
    });

    test("does not refresh when there are no source breakpoints", async () => {
        breakpointsValue.setValue([]);

        await tracker.onDidSendMessageAsync(stoppedEvent("breakpoint"));

        expect(mockSession.getDebugProtocolBreakpoint).to.not.have.been.called;
        expect(removeBreakpointsStub).to.not.have.been.called;
        expect(addBreakpointsStub).to.not.have.been.called;
    });
});
