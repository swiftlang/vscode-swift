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
import * as chai from "chai";
import { diffLines } from "diff";
import * as fs from "fs";
import * as mocha from "mocha";

import { getCapturedLogs } from "./utilities";

const EOL = "\r\n";
const SUMMARY_ENV_VAR = "GITHUB_STEP_SUMMARY";

interface AssertionError extends Error {
    showDiff?: boolean;
    actual: unknown;
    expected: unknown;
}

function isAssertionError(err: Error): err is AssertionError {
    return Object.hasOwn(err, "actual") && Object.hasOwn(err, "expected");
}

module.exports = class GitHubActionsSummaryReporter extends mocha.reporters.Base {
    private _summaryFilePath: string | null | undefined;
    get summaryFilePath(): string | null | undefined {
        if (this._summaryFilePath !== undefined) {
            return this._summaryFilePath;
        }

        const summaryPath = process.env[SUMMARY_ENV_VAR];
        if (!summaryPath) {
            this._summaryFilePath = null;
            return null;
        }

        try {
            fs.accessSync(summaryPath, fs.constants.R_OK | fs.constants.W_OK);
        } catch {
            this._summaryFilePath = null;
            return null;
        }

        this._summaryFilePath = summaryPath;
        return summaryPath;
    }

    constructor(runner: Mocha.Runner, options: any) {
        super(runner, options);

        const EVENT_RUN_END = mocha.Runner.constants.EVENT_RUN_END;
        runner.on(EVENT_RUN_END, () => {
            const title = options.reporterOption.title ?? "Test Summary";
            this.appendSummary(createMarkdownSummary(title, this.stats, this.failures));
            printCapturedLogsToConsole(this.failures);
        });
    }

    // Appends to the summary file synchronously since mocha does not support
    // asynchronous reporters.
    appendSummary(summary: string) {
        if (!this.summaryFilePath) {
            return;
        }
        fs.appendFileSync(this.summaryFilePath, summary, { encoding: "utf8" });
    }
};

function fullTitle(test: Mocha.Test | Mocha.Suite): string {
    if (test.parent && test.parent.title) {
        return fullTitle(test.parent) + " → " + test.title;
    }
    return test.title;
}

/**
 * Prints the captured extension logs for each failure to stdout. The
 * GitHubActionsSummaryReporter normally only surfaces these in the job summary
 * page, which is easy to miss; printing them to the console ensures they also
 * appear in the raw CI logs alongside the failure.
 */
function printCapturedLogsToConsole(failures: Mocha.Test[]): void {
    for (const failure of failures) {
        const logs = getCapturedLogs(failure);
        if (!logs || logs.length === 0) {
            continue;
        }
        const header = `===== Captured extension logs: ${fullTitle(failure)} =====`;
        console.log(`\n${header}\n${logs.join("\n")}\n${"=".repeat(header.length)}\n`);
    }
}

function generateErrorMessage(failure: Mocha.Test): string {
    if (!failure.err) {
        return "The test did not report what the error was.";
    }
    return convertErrorToString(failure.err);
}

function convertErrorToString(error: Error): string {
    const stackTraceFilter = mocha.utils.stackTraceFilter();
    const { message, stack } = splitStackTrace(error);
    let result = message;
    if (isAssertionError(error)) {
        const oneLineActualValue = prettyPrint(error.actual, { multiline: false });
        const actualValueWasTruncated = oneLineActualValue.length > chai.config.truncateThreshold;
        if (error.showDiff) {
            result += EOL + generateDiff(error);
        } else if (actualValueWasTruncated) {
            result += EOL + "The full actual value was:" + EOL + prettyPrint(error.actual);
        }
    }
    result += EOL + stackTraceFilter(stack);
    if (error.cause instanceof Error) {
        result += EOL + "Caused By: " + EOL + convertErrorToString(error.cause);
    }
    return result.replaceAll(/\r?\n/g, EOL);
}

function splitStackTrace(error: Error): { message: string; stack: string } {
    if (!error.stack) {
        return { message: error.message, stack: "" };
    }

    const indexOfMessage = error.stack.lastIndexOf(error.message);
    const endIndexOfMessage = indexOfMessage + error.message.length;
    return {
        message: error.stack.substring(0, endIndexOfMessage),
        stack: error.stack.substring(endIndexOfMessage + 1),
    };
}

function prettyPrint(obj: unknown, options: { multiline: boolean } = { multiline: true }): string {
    if (obj === undefined) {
        return "undefined";
    }

    if (obj === null) {
        return "null";
    }

    const spaces = options.multiline ? 2 : undefined;
    const prettyPrintedObj = JSON.stringify(obj, undefined, spaces) ?? "";
    return prettyPrintedObj.replaceAll(/\r?\n/g, EOL);
}

function generateDiff(error: AssertionError) {
    const actual = prettyPrint(error.actual);
    const expected = prettyPrint(error.expected);
    return [
        "🟩 expected 🟥 actual" + EOL + EOL,
        ...diffLines(expected, actual).map(part => {
            if (part.added) {
                return "🟩" + part.value;
            }
            if (part.removed) {
                return "🟥" + part.value;
            }
            return part.value;
        }),
    ].join("");
}

function tag(tag: string, attributes: string[], content: string): string {
    const attributeString = attributes.length > 0 ? " " + attributes.join(" ") : "";
    return `<${tag}${attributeString}>${content}</${tag}>`;
}

function details(summary: string, open: boolean, content: string): string {
    return tag(
        "details",
        open ? ["open"] : [],
        EOL + tag("summary", [], summary) + EOL + content + EOL
    );
}

function list(lines: string[]): string {
    return tag("ul", [], EOL + lines.map(line => tag("li", [], line)).join(EOL) + EOL);
}

function fixLineEndings(str: string): string {
    return str.replace(/\r?\n/g, EOL);
}

function createMarkdownSummary(title: string, stats: Mocha.Stats, failures: Mocha.Test[]): string {
    const isFailedRun = stats.failures > 0;
    let summary = tag("h3", [], "Summary");
    summary += EOL;
    summary += list([
        ...(stats.passes > 0 ? [`✅ ${stats.passes} passing test(s)`] : []),
        ...(stats.failures > 0 ? [`❌ ${stats.failures} failing test(s)`] : []),
        ...(stats.pending > 0 ? [`⚠️ ${stats.pending} pending test(s)`] : []),
    ]);
    summary += EOL;
    if (isFailedRun) {
        summary += tag("h3", [], "Test Failures");
        summary += EOL;
        summary += list(
            failures.map(failure => {
                const errorMessage = generateErrorMessage(failure);
                let content =
                    EOL +
                    tag("h5", [], fullTitle(failure)) +
                    EOL +
                    tag("pre", [], fixLineEndings(errorMessage)) +
                    EOL;
                const logs = getCapturedLogs(failure);
                if (logs && logs.length > 0) {
                    content +=
                        details(
                            "Captured Extension Logs",
                            true,
                            tag("pre", [], fixLineEndings(logs.join("\n")))
                        ) + EOL;
                }
                return content;
            })
        );
        summary += EOL;
    }
    return details(`${isFailedRun ? "❌" : "✅"} ${title}`, isFailedRun, summary) + EOL;
}
