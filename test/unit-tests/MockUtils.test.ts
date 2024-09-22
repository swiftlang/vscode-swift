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
import { mockFn, mockObject, waitForReturnedPromises } from "./MockUtils";
import { Version } from "../../src/utilities/version";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function emptyFunction(..._: any): any {
    // Intentionally empty
}

// A test suite for test code? Crazy, right?
suite("MockUtils Test Suite", () => {
    suite("waitForReturnedPromises()", () => {
        test("waits for all promises to complete before resolving", async () => {
            const values: number[] = [];
            const stubbedFn = stub<[number], Promise<void>>().callsFake(async num => {
                await new Promise<void>(resolve => {
                    setTimeout(resolve, 1);
                });
                values.push(num);
            });
            stubbedFn(1);
            stubbedFn(2);
            stubbedFn(3);

            expect(values).to.deep.equal([]);
            await waitForReturnedPromises(stubbedFn);
            expect(values).to.deep.equal([1, 2, 3]);
        });
    });

    suite("mockObject()", () => {
        test("can mock an interface", () => {
            interface TestInterface {
                a: number;
                b: string;
                c: Version;
                d(): string;
                e(_: string): string;
            }
            const sut = mockObject<TestInterface>({
                a: 5,
                b: "this is a string",
                c: new Version(6, 0, 0),
                d: emptyFunction,
                e: emptyFunction,
            });
            sut.d.returns("this is another string");
            sut.e.callsFake(input => input + "this is yet another string");

            expect(sut.a).to.equal(5);
            expect(sut.b).to.equal("this is a string");
            expect(sut.c).to.containSubset({ major: 6, minor: 0, patch: 0 });
            expect(sut.d()).to.equal("this is another string");
            expect(sut.e("a: ")).to.equal("a: this is yet another string");
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

            expect(() => sut.d()).to.throw(
                "Attempted to access property 'd', but it was not mocked"
            );
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
                d: emptyFunction,
            });
            sut.d.returns(6);

            expect(sut.a).to.equal(5);
            expect(sut.b).to.equal("this is a string");
            expect(sut.d()).to.equal(6);
        });
    });

    suite("mockFn()", () => {
        test("can fully mock a function inline", () => {
            const fn: () => number = mockFn(s => s.returns(5));
            expect(fn()).to.equal(5);
        });

        test("can be used with mockObject() to fully mock a function inline", () => {
            interface TestInterface {
                fn1(): string;
                fn2(_: string): string;
            }
            const sut = mockObject<TestInterface>({
                fn1: mockFn(s => s.returns("this is another string")),
                fn2: mockFn(s => s.callsFake(input => input + "this is yet another string")),
            });

            expect(sut.fn1()).to.equal("this is another string");
            expect(sut.fn2("a: ")).to.equal("a: this is yet another string");
        });

        test("retains type information when mocking a function", () => {
            mockFn<() => number>(s => {
                s.returns(
                    // @ts-expect-error - string is not compatible with number
                    "compiler error"
                );
            });
        });
    });
});
