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
import * as fs from "fs/promises";
import { stub } from "sinon";
import * as vscode from "vscode";

import configuration from "@src/configuration";
import { Version } from "@src/utilities/version";

import {
    AsyncEventEmitter,
    mockFn,
    mockGlobalEvent,
    mockGlobalFunction,
    mockGlobalModule,
    mockGlobalObject,
    mockGlobalValue,
    mockObject,
    waitForReturnedPromises,
} from "../MockUtils";

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
            void stubbedFn(1);
            void stubbedFn(2);
            void stubbedFn(3);

            expect(values).to.deep.equal([]);
            await waitForReturnedPromises(stubbedFn);
            expect(values).to.deep.equal([1, 2, 3]);
        });
    });

    suite("mockObject()", () => {
        test("can mock properties of an interface", () => {
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

        test("re-throws errors that occurred during the mocking process", () => {
            interface TestInterface {
                a: number;
            }
            const sut = mockObject<TestInterface>(
                new Proxy(
                    { a: 4 },
                    {
                        get() {
                            throw new Error("Cannot access this property");
                        },
                    }
                )
            );

            expect(() => sut.a).to.throw("Cannot access this property");
        });

        test("can be used as an argument to Promise.resolve()", async () => {
            interface TestInterface {
                readonly a: number;
            }
            const test = mockObject<TestInterface>({ a: 4 });
            await expect(Promise.resolve(test)).to.eventually.have.property("a", 4);
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

    suite("mockGlobalFunction()", () => {
        const asRelativePathStub = mockGlobalFunction(vscode.workspace, "asRelativePath");

        test("can mock asRelativePath() in the workspace object from the VSCode API", async () => {
            asRelativePathStub.returns("relative");

            expect(vscode.workspace.asRelativePath("absolute")).to.equal("relative");
            expect(asRelativePathStub).to.have.been.calledOnceWithExactly("absolute");
        });
    });

    suite("mockGlobalObject()", () => {
        const mockedWorkspace = mockGlobalObject(vscode, "workspace");

        test("can mock the workspace object from the VSCode API", async () => {
            mockedWorkspace.asRelativePath.returns("relative");

            expect(vscode.workspace.asRelativePath("absolute")).to.equal("relative");
            expect(mockedWorkspace.asRelativePath).to.have.been.calledOnceWithExactly("absolute");
        });
    });

    suite("mockGlobalModule()", () => {
        const mockedFS = mockGlobalModule(fs);
        const mockedConfiguration = mockGlobalModule(configuration);

        test("can mock the fs/promises module", async () => {
            mockedFS.readFile.resolves("file contents");

            await expect(fs.readFile("some_file")).to.eventually.equal("file contents");
            expect(mockedFS.readFile).to.have.been.calledOnceWithExactly("some_file");
        });

        test("can mock the configuration module", () => {
            expect(configuration.sdk).to.equal("");
            // Make sure you can set a value using the mock
            mockedConfiguration.sdk = "macOS";
            expect(configuration.sdk).to.equal("macOS");
            // Make sure you can set a value using the real module
            configuration.sdk = "watchOS";
            expect(configuration.sdk).to.equal("watchOS");
            // Mocking objects within the configuration requires separate MockedObjects
            const mockedLspConfig = mockObject<(typeof configuration)["lsp"]>(configuration.lsp);
            mockedConfiguration.lsp = mockedLspConfig;
            mockedLspConfig.disable = true;
            expect(configuration.lsp.disable).to.be.true;
        });
    });

    suite("mockGlobalValue()", () => {
        const platform = mockGlobalValue(process, "platform");

        test("can set the value of a global variable", () => {
            platform.setValue("android");
            expect(process.platform).to.equal("android");
        });
    });

    suite("mockGlobalEvent()", () => {
        const didCreateFiles = mockGlobalEvent(vscode.workspace, "onDidCreateFiles");

        test("can trigger events from the VSCode API", async () => {
            const listener = stub();
            vscode.workspace.onDidCreateFiles(listener);

            await didCreateFiles.fire({ files: [] });
            expect(listener).to.have.been.calledOnceWithExactly({ files: [] });
        });
    });

    suite("AsyncEventEmitter", () => {
        test("waits for listener's promise to resolve before resolving fire()", async () => {
            const events: number[] = [];
            const sut = new AsyncEventEmitter<number>();
            sut.event(async num => {
                await new Promise<void>(resolve => {
                    setTimeout(resolve, 1);
                });
                events.push(num);
            });

            await sut.fire(1);
            await sut.fire(2);
            await sut.fire(3);

            expect(events).to.deep.equal([1, 2, 3]);
        });

        test("event listeners can stop listening using the provided Disposable", async () => {
            const listener1 = stub();
            const listener2 = stub();
            const listener3 = stub();
            const sut = new AsyncEventEmitter<void>();

            sut.event(listener1);
            sut.event(listener2).dispose();
            sut.event(listener3);

            await sut.fire();

            expect(listener1).to.have.been.calledOnce;
            expect(listener2).to.not.have.been.called;
            expect(listener3).to.have.been.calledOnce;
        });
    });
});
