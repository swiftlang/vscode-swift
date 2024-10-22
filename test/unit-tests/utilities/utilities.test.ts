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

import { expect } from "chai";
import {
    getRepositoryName,
    stringArrayInEnglish,
    regexEscapedString,
    hashString,
    getErrorDescription,
    swiftPlatformLibraryPathKey,
    runtimeEnv,
    sourceLocationToVSCodeLocation,
} from "../../../src/utilities/utilities";
import { Range } from "vscode";

suite("Utilities Unit Test Suite", () => {
    suite("getRepositoryName", () => {
        test("regular url", () => {
            expect(getRepositoryName("https://github.com/swiftlang/vscode-swift.git")).to.equal(
                "vscode-swift"
            );
        });

        test("url does not end in .git", () => {
            expect(getRepositoryName("https://github.com/swiftlang/vscode-swift")).to.equal(
                "vscode-swift"
            );
        });

        test("URL contains a trailing slash", () => {
            expect(getRepositoryName("https://github.com/swiftlang/vscode-swift.git/")).to.equal(
                "vscode-swift"
            );
        });
        test("Name contains a dot", () => {
            expect(getRepositoryName("https://github.com/swiftlang/vscode.swift.git")).to.equal(
                "vscode.swift"
            );
        });

        test("Name contains .git", () => {
            expect(getRepositoryName("https://github.com/swiftlang/vscode.git.git")).to.equal(
                "vscode.git"
            );
        });
    });

    suite("getErrorDescription", () => {
        test('should return "No error provided" when the error is null or undefined', () => {
            expect(getErrorDescription(null)).to.equal("No error provided");
            expect(getErrorDescription(undefined)).to.equal("No error provided");
        });

        test("should return the stderr property if present", () => {
            const errorWithStderr = { stderr: "This is an error from stderr" };
            const result = getErrorDescription(errorWithStderr);
            expect(result).to.equal("This is an error from stderr");
        });

        test("should return the error property if present", () => {
            const errorWithErrorProperty = { error: "This is an error message" };
            const result = getErrorDescription(errorWithErrorProperty);
            expect(result).to.equal(JSON.stringify("This is an error message"));
        });

        test("should return the message property if the error is an instance of Error", () => {
            const standardError = new Error("This is a standard error message");
            const result = getErrorDescription(standardError);
            expect(result).to.equal("This is a standard error message");
        });

        test("should return a stringified version of the error if it is an object without stderr or error properties", () => {
            const genericObjectError = { message: "Generic error", code: 500 };
            const result = getErrorDescription(genericObjectError);
            expect(result).to.equal(JSON.stringify(genericObjectError));
        });

        test("should return a stringified version of the error if it is a string", () => {
            const stringError = "This is a string error";
            const result = getErrorDescription(stringError);
            expect(result).to.equal(JSON.stringify(stringError));
        });

        test("should return a stringified version of the error if it is a number", () => {
            const numericError = 404;
            const result = getErrorDescription(numericError);
            expect(result).to.equal(JSON.stringify(numericError));
        });

        test("should return a stringified version of an array if passed as error", () => {
            const arrayError = ["Error in item 1", "Error in item 2"];
            const result = getErrorDescription(arrayError);
            expect(result).to.equal(JSON.stringify(arrayError));
        });
    });

    suite("hashString", () => {
        test("empty string", () => {
            expect(hashString("")).to.equal(3338908027751811);
        });

        test("non empty string", () => {
            expect(hashString("foo")).to.equal(6104293464250660);
        });
    });

    suite("stringArrayInEnglish", () => {
        test("should return a single element unchanged", () => {
            expect(stringArrayInEnglish(["a"])).to.equal("a");
        });

        test("should use 'and' to concatinate two elements", () => {
            expect(stringArrayInEnglish(["a", "b"])).to.equal("a and b");
        });

        test("should handle three or more elements", () => {
            expect(stringArrayInEnglish(["a", "b", "c"])).to.equal("a, b and c");
        });
    });

    suite("regexEscapedString", () => {
        test("should escape special regex characters in a string", () => {
            expect(regexEscapedString("a.b(c)d[e]f$g^h?i|j/k:l")).to.equal(
                "a\\.b\\(c\\)d\\[e\\]f\\$g\\^h\\?i\\|j\\/k\\:l"
            );
        });

        test("should not escape characters that are not special regex characters", () => {
            expect(regexEscapedString("abcde12345")).to.equal("abcde12345");
        });

        test("should escape a string that contains only special regex characters", () => {
            expect(regexEscapedString(".^$|()?[]/:")).to.equal("\\.\\^\\$\\|\\(\\)\\?\\[\\]\\/\\:");
        });

        test("should escape a string that omits some characters", () => {
            expect(regexEscapedString(".^$|()?[]/:", new Set(["^", "$", "a"]))).to.equal(
                "\\.^$\\|\\(\\)\\?\\[\\]\\/\\:"
            );
        });

        test("should return an empty string when input is an empty string", () => {
            expect(regexEscapedString("")).to.equal("");
        });
    });

    suite("swiftPlatformLibraryPathKey", () => {
        test("returns correct key for Windows", () => {
            expect(swiftPlatformLibraryPathKey("win32")).to.equal("Path");
        });

        test("returns correct key for Darwin", () => {
            expect(swiftPlatformLibraryPathKey("darwin")).to.equal("DYLD_LIBRARY_PATH");
        });

        test("returns correct key for Linux", () => {
            expect(swiftPlatformLibraryPathKey("linux")).to.equal("LD_LIBRARY_PATH");
        });
    });

    suite("runtimeEnv", () => {
        test("returns undefined when empty value", () => {
            expect(runtimeEnv({}, "Path", "", ";")).to.equal(undefined);
        });

        test("returns value without separator when key doesn't exist", () => {
            expect(runtimeEnv({}, "Path", "/my/path", ";")).to.deep.equal({ Path: "/my/path" });
        });

        test("returns value with separator when key already exists", () => {
            expect(runtimeEnv({ Path: "/my/other/path" }, "Path", "/my/path", ";")).to.deep.equal({
                Path: "/my/path;/my/other/path",
            });
        });

        test("returns value without other keys still present", () => {
            expect(runtimeEnv({ FOO: "bar", BAZ: "1" }, "Path", "/my/path", ";")).to.deep.equal({
                Path: "/my/path",
            });
        });
    });

    suite("sourceLocationToVSCodeLocation", () => {
        test("rows and columns are 0-based", () => {
            expect(
                sourceLocationToVSCodeLocation("/my/file", 1, 0).range.isEqual(
                    new Range(0, 0, 0, 0)
                )
            ).to.be.true;
            expect(
                sourceLocationToVSCodeLocation("/my/file", 10, 4).range.isEqual(
                    new Range(9, 4, 9, 4)
                )
            ).to.be.true;
        });

        test("columns default to 0", () => {
            expect(
                sourceLocationToVSCodeLocation("/my/file", 1, undefined).range.isEqual(
                    new Range(0, 0, 0, 0)
                )
            ).to.be.true;
        });
    });
});
