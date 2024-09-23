import * as vscode from "vscode";
import { expect } from "chai";
import { mockObject, instance, MockedObject } from "../../MockUtils";
import {
    LoggingDebugAdapterTracker,
    LoggingDebugAdapterTrackerFactory,
} from "../../../src/debugger/logTracker";
import sinon = require("sinon");

suite("LoggingDebugAdapterTrackerFactory Test Suite", () => {
    const factory = new LoggingDebugAdapterTrackerFactory();

    // Clean up the static members before each test to ensure isolation
    teardown(() => {
        LoggingDebugAdapterTracker["debugSessionIdMap"] = {};
    });

    test("should create LoggingDebugAdapterTracker instance", () => {
        const mockSession = mockObject<vscode.DebugSession>({ id: "session-1" });
        const tracker = factory.createDebugAdapterTracker(instance(mockSession));

        expect(tracker).to.be.instanceOf(LoggingDebugAdapterTracker);
        expect((tracker as LoggingDebugAdapterTracker).id).to.equal("session-1");
    });

    test("should handle zero, one, and multiple sessions", () => {
        const mockSession1 = mockObject<vscode.DebugSession>({ id: "session-1" });
        const mockSession2 = mockObject<vscode.DebugSession>({ id: "session-2" });

        // Test 0 sessions: map should be empty
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.be.empty;

        // Test 1 session
        factory.createDebugAdapterTracker(instance(mockSession1)) as LoggingDebugAdapterTracker;
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.include(
            "session-1"
        );

        // Test 2 sessions
        factory.createDebugAdapterTracker(instance(mockSession2)) as LoggingDebugAdapterTracker;
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.have.length(2);
        expect(LoggingDebugAdapterTracker["debugSessionIdMap"]).to.have.property("session-1");
        expect(LoggingDebugAdapterTracker["debugSessionIdMap"]).to.have.property("session-2");
    });

    test("should tear down sessions on stop", () => {
        const mockSession1 = mockObject<vscode.DebugSession>({ id: "session-1" });
        const mockSession2 = mockObject<vscode.DebugSession>({ id: "session-2" });

        const tracker1 = factory.createDebugAdapterTracker(
            instance(mockSession1)
        ) as LoggingDebugAdapterTracker;
        const tracker2 = factory.createDebugAdapterTracker(
            instance(mockSession2)
        ) as LoggingDebugAdapterTracker;

        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.have.length(2);

        // Simulate stopping session 1
        tracker1.onWillStopSession!();
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.not.include(
            "session-1"
        );
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.have.length(1);

        // Simulate stopping session 2
        tracker2.onWillStopSession!();
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.have.length(0);
    });

    test("should handle a large number of sessions", () => {
        const sessionCount = 1000;
        const mockSessions = [];

        // Create and add 1000 sessions
        for (let i = 0; i < sessionCount; i++) {
            const sessionId = `session-${i}`;
            const mockSession = mockObject<vscode.DebugSession>({ id: sessionId });
            const tracker = factory.createDebugAdapterTracker(
                instance(mockSession)
            ) as LoggingDebugAdapterTracker;
            mockSessions.push(tracker);
        }

        // Verify that all 1000 sessions are in the map
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.have.length(
            sessionCount
        );

        // Simulate stopping all sessions
        mockSessions.forEach(tracker => {
            tracker.onWillStopSession!();
        });

        // Verify that all sessions are removed
        expect(Object.keys(LoggingDebugAdapterTracker["debugSessionIdMap"])).to.have.length(0);
    });
});

suite("LoggingDebugAdapterTracker Callback Test Suite", () => {
    let callbackSpy: sinon.SinonSpy;
    let mockSession: MockedObject<vscode.DebugSession>;

    // Before each test, reset the callback spy, static member, and create a new mock session
    setup(() => {
        callbackSpy = sinon.spy();
        mockSession = mockObject<vscode.DebugSession>({ id: "session-1" });
    });

    teardown(() => {
        LoggingDebugAdapterTracker["debugSessionIdMap"] = {}; // Reset static state
    });

    test("should set and call the callback with 'output' event", () => {
        const tracker = new LoggingDebugAdapterTracker(mockSession.id);
        LoggingDebugAdapterTracker.setDebugSessionCallback(instance(mockSession), callbackSpy);

        const debugMessage = {
            seq: 1,
            type: "event",
            event: "output",
            body: { category: "stderr", output: "Test Output" },
        };

        tracker.onDidSendMessage(debugMessage);

        expect(callbackSpy).to.have.been.calledOnceWith("Test Output");
    });

    test("should not call callback for non-'event' type messages", () => {
        const tracker = new LoggingDebugAdapterTracker(mockSession.id);
        LoggingDebugAdapterTracker.setDebugSessionCallback(instance(mockSession), callbackSpy);

        const debugMessage = {
            seq: 1,
            type: "request", // Non-event type
            event: "output",
            body: { category: "stderr", output: "Test Output" },
        };

        tracker.onDidSendMessage(debugMessage);

        expect(callbackSpy).to.not.have.been.called;
    });

    test("should not call callback for 'console' category output", () => {
        const tracker = new LoggingDebugAdapterTracker(mockSession.id);
        LoggingDebugAdapterTracker.setDebugSessionCallback(instance(mockSession), callbackSpy);

        const debugMessage = {
            seq: 1,
            type: "event",
            event: "output",
            body: { category: "console", output: "Console Output" }, // "console" category
        };

        tracker.onDidSendMessage(debugMessage);

        expect(callbackSpy).to.not.have.been.called;
    });

    test("should not call callback if no callback is set", () => {
        const tracker = new LoggingDebugAdapterTracker(mockSession.id);

        const debugMessage = {
            seq: 1,
            type: "event",
            event: "output",
            body: { category: "stderr", output: "Test Output" },
        };

        tracker.onDidSendMessage(debugMessage);

        // Since no callback is set, the spy should not be called
        expect(callbackSpy).to.not.have.been.called;
    });

    test("should set and call the callback with multiple valid events", () => {
        const tracker = new LoggingDebugAdapterTracker(mockSession.id);
        LoggingDebugAdapterTracker.setDebugSessionCallback(instance(mockSession), callbackSpy);

        const debugMessage1 = {
            seq: 1,
            type: "event",
            event: "output",
            body: { category: "stderr", output: "Test Output 1" },
        };

        const debugMessage2 = {
            seq: 2,
            type: "event",
            event: "output",
            body: { category: "stderr", output: "Test Output 2" },
        };

        tracker.onDidSendMessage(debugMessage1);
        tracker.onDidSendMessage(debugMessage2);

        expect(callbackSpy).to.have.been.calledTwice;
        expect(callbackSpy.firstCall).to.have.been.calledWith("Test Output 1");
        expect(callbackSpy.secondCall).to.have.been.calledWith("Test Output 2");
    });

    test("should handle a large number of debug messages", () => {
        const tracker = new LoggingDebugAdapterTracker(mockSession.id);
        LoggingDebugAdapterTracker.setDebugSessionCallback(instance(mockSession), callbackSpy);

        const messageCount = 1000;

        for (let i = 0; i < messageCount; i++) {
            const debugMessage = {
                seq: i,
                type: "event",
                event: "output",
                body: { category: "stderr", output: `Output Message ${i}` },
            };

            tracker.onDidSendMessage(debugMessage);
        }

        // Verify that the callback was called 1000 times
        expect(callbackSpy).to.have.callCount(messageCount);

        // Pick and verify a specific call
        expect(callbackSpy.getCall(999)).to.have.been.calledWith("Output Message 999");
    });
});
