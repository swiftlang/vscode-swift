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

import { RollingLog } from "@src/logging/RollingLog";
import { RollingLogTransport } from "@src/logging/RollingLogTransport";
import { SwiftLogger } from "@src/logging/SwiftLogger";

suite("SwiftLogger Unit Test Suite", () => {
    let fakeTimers: sinon.SinonFakeTimers;
    let rollingLog: RollingLog;
    let logger: SwiftLogger;

    setup(() => {
        fakeTimers = sinon.useFakeTimers(new Date(2026, 5, 10, 0, 0, 0, 0));
        rollingLog = new RollingLog(100);
        logger = new SwiftLogger([new RollingLogTransport(rollingLog)]);
    });

    teardown(() => {
        fakeTimers.restore();
        logger.dispose();
    });

    test("adds the log level to the log entry", () => {
        logger.info("this is an info message");
        logger.warn("this is a warning message");
        logger.error("this is an error message");
        logger.debug("this is a debug message");

        expect(rollingLog.logs).to.deep.equal([
            "[2026-06-10 00:00:00.000] [info] this is an info message",
            "[2026-06-10 00:00:00.000] [warn] this is a warning message",
            "[2026-06-10 00:00:00.000] [error] this is an error message",
            "[2026-06-10 00:00:00.000] [debug] this is a debug message",
        ]);
    });

    test("includes the provided label in the log entry", () => {
        logger.info("test", { label: "MyComponent" });

        expect(rollingLog.logs).to.deep.equal([
            "[2026-06-10 00:00:00.000] [info] MyComponent: test",
        ]);
    });

    test("includes the full error stack track to the log entry", () => {
        const error = Error("something failed");
        error.stack = `Error: something failed
    at Context.<anonymous> (test/unit-tests/logging/SwiftLogger.test.ts:69:41)
    at processImmediate (node:internal/timers:485:21)`;
        logger.error(error);

        expect(rollingLog.logs).to.deep.equal([`[2026-06-10 00:00:00.000] [error] ${error.stack}`]);
    });

    test("logs Error objects with cause chain", () => {
        const cause = Error("root cause");
        cause.stack = `Error: root cause
    at Context.<anonymous> (test/unit-tests/logging/SwiftLogger.test.ts:69:41)
    at processImmediate (node:internal/timers:485:21)`;
        const error = Error("something failed", { cause });
        error.stack = `Error: something failed
    at Context.<anonymous> (test/unit-tests/logging/SwiftLogger.test.ts:69:41)
    at processImmediate (node:internal/timers:485:21)`;
        logger.error(error);

        expect(rollingLog.logs).to.deep.equal([
            `[2026-06-10 00:00:00.000] [error] ${error.stack}\nCaused by: ${cause.stack}`,
        ]);
    });

    test("logs Error with non-Error cause", () => {
        const error = Error("something failed", { cause: "something went wrong" });
        error.stack = `Error: something failed
    at Context.<anonymous> (test/unit-tests/logging/SwiftLogger.test.ts:69:41)
    at processImmediate (node:internal/timers:485:21)`;
        logger.error(error);
        error.cause = { key: "value", num: 42 };
        logger.error(error);

        expect(rollingLog.logs).to.deep.equal([
            `[2026-06-10 00:00:00.000] [error] ${error.stack}\nCaused by: something went wrong`,
            `[2026-06-10 00:00:00.000] [error] ${error.stack}\nCaused by: {"key":"value","num":42}`,
        ]);
    });

    test("logs Error with nested cause chain", () => {
        const rootCause = Error("root cause");
        rootCause.stack = `Error: root cause
    at Context.<anonymous> (test/unit-tests/logging/SwiftLogger.test.ts:69:41)
    at processImmediate (node:internal/timers:485:21)`;
        const cause = Error("middle cause", { cause: rootCause });
        cause.stack = `Error: middle cause
    at Context.<anonymous> (test/unit-tests/logging/SwiftLogger.test.ts:69:41)
    at processImmediate (node:internal/timers:485:21)`;
        const error = Error("something failed", { cause });
        error.stack = `Error: something failed
    at Context.<anonymous> (test/unit-tests/logging/SwiftLogger.test.ts:69:41)
    at processImmediate (node:internal/timers:485:21)`;
        logger.error(error);

        expect(rollingLog.logs).to.deep.equal([
            `[2026-06-10 00:00:00.000] [error] ${error.stack}\nCaused by: ${cause.stack}\nCaused by: ${rootCause.stack}`,
        ]);
    });

    test("logs non-string messages as JSON", () => {
        logger.info({ key: "value", num: 42 });

        expect(rollingLog.logs).to.deep.equal([
            '[2026-06-10 00:00:00.000] [info] {"key":"value","num":42}',
        ]);
    });

    test("logs objects that cannot be serialized by JSON", () => {
        const circularReference: Record<string, unknown> = {};
        circularReference.self = circularReference;
        logger.info(circularReference);
        logger.info(undefined);
        logger.info(null);

        expect(rollingLog.logs).to.deep.equal([
            "[2026-06-10 00:00:00.000] [info] [object Object]",
            "[2026-06-10 00:00:00.000] [info] undefined",
            "[2026-06-10 00:00:00.000] [info] null",
        ]);
    });

    test("stops logging after dispose", () => {
        logger.info("before");
        logger.dispose();
        logger.info("after");

        expect(rollingLog.logs).to.deep.equal(["[2026-06-10 00:00:00.000] [info] before"]);
    });

    test("createTransport produces a transport that logs to this logger", () => {
        const logger2 = new SwiftLogger();
        logger2.addTransport(logger.createTransport());
        logger2.info("from logger2");
        expect(rollingLog.logs).to.have.lengthOf(1);
        expect(rollingLog.logs[0]).to.include("from logger2");
        logger2.dispose();
    });
});
