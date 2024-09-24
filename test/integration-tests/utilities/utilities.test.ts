//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as assert from "assert";
import * as Stream from "stream";
import {
    execFileStreamOutput,
    getRepositoryName,
    execSwift,
    getSwiftExecutable,
    stringArrayInEnglish,
    regexEscapedString,
    hashString,
    getErrorDescription,
} from "../../../src/utilities/utilities";

suite("Utilities Test Suite", () => {
    test("execFileStreamOutput", async () => {
        const swift = getSwiftExecutable();
        let result = "";
        // Use WriteStream to log results
        const writeStream = new Stream.Writable();
        writeStream._write = (chunk, encoding, next) => {
            const text = chunk.toString("utf8");
            result += text;
            next();
        };
        writeStream.on("close", () => {
            writeStream.end();
        });

        const { stdout } = await execSwift(["--version"], "default");
        await execFileStreamOutput(swift, ["--version"], writeStream, null, null);
        assert(result.length > 0);
        assert(result.includes("Swift version"));
        assert.strictEqual(result, stdout);
    });

    suite("getRepositoryName", () => {
        test("regular url", () => {
            assert.strictEqual(
                getRepositoryName("https://github.com/swift-server/vscode-swift.git"),
                "vscode-swift"
            );
        });

        test("url does not end in .git", () => {
            assert.strictEqual(
                getRepositoryName("https://github.com/swift-server/vscode-swift"),
                "vscode-swift"
            );
        });

        test("URL contains a trailing slash", () => {
            assert.strictEqual(
                getRepositoryName("https://github.com/swift-server/vscode-swift.git/"),
                "vscode-swift"
            );
        });
        test("Name contains a dot", () => {
            assert.strictEqual(
                getRepositoryName("https://github.com/swift-server/vscode.swift.git"),
                "vscode.swift"
            );
        });

        test("Name contains .git", () => {
            assert.strictEqual(
                getRepositoryName("https://github.com/swift-server/vscode.git.git"),
                "vscode.git"
            );
        });
    });

    suite("getErrorDescription", () => {
        test('should return "No error provided" when the error is null or undefined', () => {
            assert.strictEqual(getErrorDescription(null), "No error provided");
            assert.strictEqual(getErrorDescription(undefined), "No error provided");
        });

        test("should return the stderr property if present", () => {
            const errorWithStderr = { stderr: "This is an error from stderr" };
            const result = getErrorDescription(errorWithStderr);
            assert.strictEqual(result, "This is an error from stderr");
        });

        test("should return the error property if present", () => {
            const errorWithErrorProperty = { error: "This is an error message" };
            const result = getErrorDescription(errorWithErrorProperty);
            assert.strictEqual(result, JSON.stringify("This is an error message"));
        });

        test("should return the message property if the error is an instance of Error", () => {
            const standardError = new Error("This is a standard error message");
            const result = getErrorDescription(standardError);
            assert.strictEqual(result, "This is a standard error message");
        });

        test("should return a stringified version of the error if it is an object without stderr or error properties", () => {
            const genericObjectError = { message: "Generic error", code: 500 };
            const result = getErrorDescription(genericObjectError);
            assert.strictEqual(result, JSON.stringify(genericObjectError));
        });

        test("should return a stringified version of the error if it is a string", () => {
            const stringError = "This is a string error";
            const result = getErrorDescription(stringError);
            assert.strictEqual(result, JSON.stringify(stringError));
        });

        test("should return a stringified version of the error if it is a number", () => {
            const numericError = 404;
            const result = getErrorDescription(numericError);
            assert.strictEqual(result, JSON.stringify(numericError));
        });

        test("should return a stringified version of an array if passed as error", () => {
            const arrayError = ["Error in item 1", "Error in item 2"];
            const result = getErrorDescription(arrayError);
            assert.strictEqual(result, JSON.stringify(arrayError));
        });
    });

    suite("hashString", () => {
        test("empty string", () => {
            assert.strictEqual(hashString(""), 3338908027751811);
        });

        test("non empty string", () => {
            assert.strictEqual(hashString("foo"), 6104293464250660);
        });
    });

    suite("stringArrayInEnglish", () => {
        test("should return a single element unchanged", () => {
            assert.strictEqual(stringArrayInEnglish(["a"]), "a");
        });

        test("should use 'and' to concatinate two elements", () => {
            assert.strictEqual(stringArrayInEnglish(["a", "b"]), "a and b");
        });

        test("should handle three or more elements", () => {
            assert.strictEqual(stringArrayInEnglish(["a", "b", "c"]), "a, b and c");
        });
    });

    suite("regexEscapedString", () => {
        test("should escape special regex characters in a string", () => {
            assert.strictEqual(
                regexEscapedString("a.b(c)d[e]f$g^h?i|j/k:l"),
                "a\\.b\\(c\\)d\\[e\\]f\\$g\\^h\\?i\\|j\\/k\\:l"
            );
        });

        test("should not escape characters that are not special regex characters", () => {
            assert.strictEqual(regexEscapedString("abcde12345"), "abcde12345");
        });

        test("should escape a string that contains only special regex characters", () => {
            assert.strictEqual(
                regexEscapedString(".^$|()?[]/:"),
                "\\.\\^\\$\\|\\(\\)\\?\\[\\]\\/\\:"
            );
        });

        test("should escape a string that omits some characters", () => {
            assert.strictEqual(
                regexEscapedString(".^$|()?[]/:", new Set(["^", "$", "a"])),
                "\\.^$\\|\\(\\)\\?\\[\\]\\/\\:"
            );
        });

        test("should return an empty string when input is an empty string", () => {
            assert.strictEqual(regexEscapedString(""), "");
        });
    });
});
