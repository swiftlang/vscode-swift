//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import { expect } from "chai";
import { stub } from "sinon";
import { mockObject } from "./MockUtils";
import { Version } from "../../src/utilities/version";

// A test suite for test code? Crazy, right?
suite("MockUtils2 Test Suite", () => {
    test("can mock an interface", () => {
        interface TestInterface {
            a: number;
            b: string;
            c: Version;
            d(): string;
        }
        const sut = mockObject<TestInterface>({
            a: 5,
            b: "this is a string",
            c: new Version(6, 0, 0),
            d: stub(),
        });
        sut.d.returns("this is another string");

        expect(sut.a).to.equal(5);
        expect(sut.b).to.equal("this is a string");
        expect(sut.c).to.containSubset({ major: 6, minor: 0, patch: 0 });
        expect(sut.d()).to.equal("this is another string");
    });

    test("can mock an interface with readonly properties", () => {
        interface TestInterface {
            readonly a: number;
        }
        const sut = mockObject<TestInterface>({
            a: 0,
        });

        sut.a = 17;
        expect(sut.a).to.equal(17);
    });

    test("can ommit properties from being mocked", () => {
        interface TestInterface {
            a: number;
            b: string;
            c: Version;
            d(): string;
        }
        const sut = mockObject<TestInterface>({
            a: 5,
        });

        expect(() => sut.d()).to.throw("Attempted to access property 'd', but it was not mocked");
    });

    test("can pass a mocked interface as a function parameter", () => {
        interface TestInterface {
            readonly a: number;
        }
        function testFn(arg: TestInterface): number {
            return arg.a;
        }
        const sut = mockObject<TestInterface>({
            a: 0,
        });

        expect(testFn(sut)).to.equal(0);
    });

    test("can mock a class", () => {
        class TestClass {
            a: number = 5;
            b: string = "hello";
            private c: string = "there";
            d(): number {
                return 5;
            }
        }
        const sut = mockObject<TestClass>({
            a: 5,
            b: "this is a string",
            d: stub(),
        });
        sut.d.returns(6);

        expect(sut.a).to.equal(5);
        expect(sut.b).to.equal("this is a string");
        expect(sut.d()).to.equal(6);
    });
});
