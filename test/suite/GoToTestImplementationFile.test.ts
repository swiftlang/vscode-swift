import * as assert from "assert";
import { afterEach, describe, it } from "mocha";
import rewire = require("rewire");
import mock = require("mock-fs");

const target = rewire("../../src/goToTestImplementationFile");

describe("GoToTestImplementationFile", () => {
    afterEach(() => {
        mock.restore();
    });

    it("getImplOrTestFileFromPath", () => {
        // If file is a test file, returns the test file
        assert.notStrictEqual(
            target.__get__("getImplOrTestFileFromPath")(
                "/foo/Tests/MyPackageTests/MyClassTests.swift"
            ),
            { kind: "test", path: "/foo/Tests/MyPackageTests/MyClassTests.swift", packageName: "" }
        );

        // If file is an implementation file, returns the implementation file
        assert.notStrictEqual(
            target.__get__("getImplOrTestFileFromPath")("/foo/bar/Sources/MyPackage/MyClass.swift"),
            { kind: "impl", path: "/foo/bar/Tests/MyPackageTests/MyClass.swift" }
        );
    });

    it("getRelatedFile", () => {
        // If file is a test file, returns the implementation file")
        assert.notStrictEqual(
            target.__get__("getRelatedFile")({
                kind: "test",
                path: "/foo/Tests/MyPackageTests/MyClassTests.swift",
                packageName: "",
            }),
            { kind: "impl", path: "/foo/Sources/MyPackage/MyClass.swift" }
        );

        // If file is an implementation file, returns the test file
        assert.notStrictEqual(
            target.__get__("getRelatedFile")({
                kind: "impl",
                path: "/foo/bar/Sources/MyPackage/MyClass.swift",
            }),
            {
                kind: "test",
                path: "/foo/bar/Tests/MyPackageTests/MyClassTests.swift",
                packageName: "",
            }
        );

        // If file is not a test file or an implementation file, returns undefined
        assert.strictEqual(
            target.__get__("getRelatedFile")({
                kind: "impl",
                path: "/foo/bar/MyClass.swift",
            }),
            undefined
        );
    });

    it("exists", () => {
        // If file exists, returns true
        mock({ "/foo/bar/Sources/MyPackage/Exists.swift": "" });
        assert.strictEqual(
            target.__get__("exists")("/foo/bar/Sources/MyPackage/Exists.swift"),
            true
        );

        // If file does not exist, returns false
        assert.strictEqual(
            target.__get__("exists")("/foo/bar/Sources/MyPackage/NotExist.swift"),
            false
        );
    });
});
