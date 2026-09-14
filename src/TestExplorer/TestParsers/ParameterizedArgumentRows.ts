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
import { TestClass } from "../TestDiscovery";
import { ITestRunState } from "./TestRunState";

/**
 * How many argument rows a run will list up front, in a pending state, across all of its
 * parameterized tests.
 */
export const MAX_PARAMETERIZED_PENDING_ROWS = 1000;

/**
 * How many failing argument rows a run will list for the parameterized tests it held back. Kept
 * separate from the pending budget so a run that spends that one up front can still show why a
 * later test failed.
 */
export const MAX_PARAMETERIZED_FAILURE_ROWS = 1000;

const PASSED_SUMMARY_ID = "swift.passedTestCases";

/**
 * The part of the test run that argument rows are written to. `TestRunProxy` satisfies this type.
 */
export type ParameterizedTestCaseSink = {
    clearParameterizedTestCases(parentIndex: number): void;
    /** Adds one argument row, returning its test item index, or undefined if the parent is gone. */
    addParameterizedTestCase(testClass: TestClass, parentIndex: number): number | undefined;
};

/** An argument of a parameterized test, as named in the test run's events. */
type Argument = {
    id: string;
    label: string;
};

type ParameterizedFunction = {
    parentIndex: number;
    /** Whether the function's arguments were too numerous to list up front. */
    heldBack: boolean;
    /** Argument id to the index of the test item listed for it. */
    rows: Map<string, number>;
    /** When each argument started, so a held back row can be given a duration once listed. */
    startInstants: Map<string, number>;
    failed: Set<string>;
    passed: number;
};

const argumentSortText = (index: number) => `${index}`.padStart(8, "0");

/** Sorts after every `argumentSortText`, putting the summary below the arguments. */
const SUMMARY_SORT_TEXT = "99999999";

function argumentTestClass(id: string, label: string, sortText: string): TestClass {
    return {
        id,
        label,
        tags: [],
        children: [],
        style: "swift-testing",
        location: undefined,
        disabled: true,
        sortText,
    };
}

/**
 * Decides which of a run's parameterized test arguments should be shown in the Test
 * Explorer.
 *
 * Every listed row costs the UI a state update as it starts and another as it ends, so a
 * cross-product test with tens of thousands of arguments stalls the Test Explorer. A run gets a
 * budget of rows to list up front; a test that no longer fits is held back, and only its failures
 * earn a row, with its passes collapsed into a single summary row when the test function ends.
 */
export class ParameterizedArgumentRows {
    private functions = new Map<string, ParameterizedFunction>();
    private pendingRows = 0;
    private failureRows = 0;
    private failureBudgetNoticeSent = false;

    constructor(private sink: ParameterizedTestCaseSink) {}

    /**
     * Takes over a parameterized test function, discarding any rows a previous run left under it
     * and listing its arguments up front if the run can still afford them.
     *
     * @param argumentCount How many arguments the function has, which is all the budget needs.
     * @param listArguments The arguments, only called when they are going to be listed — a held
     *   back function can have tens of thousands, and naming them all up front is wasted work.
     */
    public begin(
        functionName: string,
        parentIndex: number,
        argumentCount: number,
        listArguments: () => Argument[]
    ) {
        this.sink.clearParameterizedTestCases(parentIndex);

        const fn: ParameterizedFunction = {
            parentIndex,
            heldBack: this.pendingRows + argumentCount > MAX_PARAMETERIZED_PENDING_ROWS,
            rows: new Map(),
            startInstants: new Map(),
            failed: new Set(),
            passed: 0,
        };
        this.functions.set(functionName, fn);
        if (fn.heldBack) {
            return;
        }

        listArguments().forEach((argument, index) =>
            this.list(fn, argument, argumentSortText(index))
        );
        this.pendingRows += fn.rows.size;
    }

    /**
     * Records that an argument started.
     * @param resolveIndex Resolves the index of an argument this doesn't own a row for.
     * @returns The index to start, or undefined when the run deliberately has no row for it.
     */
    public noteStarted(
        functionName: string,
        argumentId: string,
        instant: number,
        resolveIndex: () => number
    ): number | undefined {
        const fn = this.functions.get(functionName);
        if (!fn) {
            return resolveIndex();
        }

        if (fn.heldBack) {
            fn.startInstants.set(argumentId, instant);
            return undefined;
        }
        return fn.rows.get(argumentId) ?? resolveIndex();
    }

    /**
     * Records that an argument produced an issue, listing a row for it if it was held back and the
     * run can still afford one.
     * @returns The row the issue belongs to, or undefined when it belongs on the test function.
     */
    public noteIssue(
        functionName: string,
        argument: Argument,
        instant: number,
        runState: ITestRunState
    ): number | undefined {
        const fn = this.functions.get(functionName);
        if (!fn) {
            return undefined;
        }

        // Warnings arrive here as issues too; an argument with either is worth a row of its own.
        fn.failed.add(argument.id);

        const listed = fn.rows.get(argument.id);
        if (listed !== undefined || !fn.heldBack) {
            return listed;
        }

        if (this.failureRows >= MAX_PARAMETERIZED_FAILURE_ROWS) {
            this.reportFailureBudgetExhausted(runState);
            return fn.parentIndex;
        }

        const row = this.list(fn, argument, argumentSortText(fn.rows.size));
        if (row === undefined) {
            return undefined;
        }
        this.failureRows += 1;

        // A held back row is listed after its `testCaseStarted`, and completing with a timestamp
        // is an error unless the row was started with one.
        runState.started(row, fn.startInstants.get(argument.id) ?? instant);
        return row;
    }

    /**
     * Records that an argument finished.
     * @param resolveIndex Resolves the index of an argument this doesn't own a row for.
     * @returns The index to complete, or undefined when the run deliberately has no row for it.
     */
    public noteEnded(
        functionName: string,
        argumentId: string,
        resolveIndex: () => number
    ): number | undefined {
        const fn = this.functions.get(functionName);
        if (!fn) {
            return resolveIndex();
        }

        fn.startInstants.delete(argumentId);
        const failed = fn.failed.delete(argumentId);

        const row = fn.rows.get(argumentId);
        if (row !== undefined) {
            return row;
        }
        if (!fn.heldBack) {
            return resolveIndex();
        }

        // A held back pass only ever reaches the UI through the summary row this tallies towards;
        // its failures already have a row.
        if (!failed) {
            fn.passed += 1;
        }
        return undefined;
    }

    /** Releases a test function, listing the single row standing in for its passing arguments. */
    public finish(functionName: string, instant: number, runState: ITestRunState) {
        const fn = this.functions.get(functionName);
        this.functions.delete(functionName);
        if (!fn?.passed) {
            return;
        }

        const row = this.sink.addParameterizedTestCase(
            argumentTestClass(
                `${functionName}/${PASSED_SUMMARY_ID}`,
                `${fn.passed.toLocaleString()} test case${fn.passed === 1 ? "" : "s"} passed`,
                SUMMARY_SORT_TEXT
            ),
            fn.parentIndex
        );
        if (row === undefined) {
            return;
        }

        runState.started(row, instant);
        runState.completed(row, { timestamp: instant });
    }

    private list(
        fn: ParameterizedFunction,
        argument: Argument,
        sortText: string
    ): number | undefined {
        const row = this.sink.addParameterizedTestCase(
            argumentTestClass(argument.id, argument.label, sortText),
            fn.parentIndex
        );
        if (row === undefined) {
            return undefined;
        }
        fn.rows.set(argument.id, row);
        return row;
    }

    private reportFailureBudgetExhausted(runState: ITestRunState) {
        if (this.failureBudgetNoticeSent) {
            return;
        }
        this.failureBudgetNoticeSent = true;

        runState.recordOutput(
            undefined,
            `Listing the first ${MAX_PARAMETERIZED_FAILURE_ROWS} failing parameterized arguments for this run; the rest are reported on their test functions.\r\n`
        );
    }
}
