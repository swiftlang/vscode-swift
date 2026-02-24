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
import { diffLines } from "diff";
import * as fs from "fs";
import * as mocha from "mocha";

const SUMMARY_ENV_VAR = "GITHUB_STEP_SUMMARY";

interface AssertionError extends Error {
    showDiff?: boolean;
    actual: string;
    expected: string;
}

function isAssertionError(err: Error): err is AssertionError {
    return typeof (err as any).actual === "string" && typeof (err as any).expected === "string";
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
        return fullTitle(test.parent) + " | " + test.title;
    }
    return test.title;
}

function generateErrorMessage(failure: Mocha.Test): string {
    if (!failure.err) {
        return "The test did not report what the error was.";
    }

    const stackTraceFilter = mocha.utils.stackTraceFilter();
    if (isAssertionError(failure.err) && failure.err.showDiff) {
        const { message, stack } = splitStackTrace(failure.err);
        return (
            message +
            eol() +
            generateDiff(failure.err.actual, failure.err.expected) +
            eol() +
            eol() +
            stackTraceFilter(stack)
        );
    }
    if (failure.err.stack) {
        return stackTraceFilter(failure.err.stack);
    }
    return mocha.utils.stringify(failure.err);
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

function generateDiff(actual: string, expected: string) {
    return [
        "🟩 expected 🟥 actual\n\n",
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
        eol() + tag("summary", [], summary) + eol() + content + eol()
    );
}

function list(lines: string[]): string {
    return tag("ul", [], eol() + lines.map(line => tag("li", [], line)).join(eol()) + eol());
}

function eol(): string {
    if (process.platform === "win32") {
        return "\r\n";
    }
    return "\n";
}

function createMarkdownSummary(title: string, stats: Mocha.Stats, failures: Mocha.Test[]): string {
    const isFailedRun = stats.failures > 0;
    let summary = tag("h3", [], "Summary") + eol();
    summary += list([
        ...(stats.passes > 0 ? [`✅ ${stats.passes} passing test(s)`] : []),
        ...(stats.failures > 0 ? [`❌ ${stats.failures} failing test(s)`] : []),
        ...(stats.pending > 0 ? [`⚠️ ${stats.pending} pending test(s)`] : []),
    ]);
    if (isFailedRun) {
        summary += tag("h3", [], "Test Failures");
        summary += list(
            failures.map(failure => {
                const errorMessage = generateErrorMessage(failure);
                return (
                    eol() +
                    tag("h5", [], fullTitle(failure)) +
                    eol() +
                    tag("pre", [], eol() + errorMessage + eol()) +
                    eol()
                );
            })
        );
    }
    return details(`${isFailedRun ? "❌" : "✅"} ${title}`, isFailedRun, summary) + eol();
}
