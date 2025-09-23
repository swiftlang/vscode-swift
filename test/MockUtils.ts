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
import { memfs } from "memfs";
import * as path from "path";
import { SinonSandbox, SinonStub, createSandbox, stub } from "sinon";
import * as vscode from "vscode";

import { FileSystem } from "@src/services/FileSystem";

/**
 * Waits for all promises returned by a MockedFunction to resolve. Useful when
 * the code you're testing doesn't await the function being mocked, but instead
 * lets it run in the background.
 *
 * @param mockedFn the mocked function to retrieve return values from
 */
export async function waitForReturnedPromises(
    mockedFn: MockedFunction<(...args: any) => Thenable<any>>
): Promise<void> {
    for (const promise of mockedFn.returnValues) {
        await promise;
    }
}

export function inMemoryFileSystem(): FileSystem {
    return createMochaProxy<FileSystem>("Mock FileSystem", {
        setup() {
            const { fs } = memfs();
            return {
                async withTemporaryDirectory(prefix, body) {
                    await fs.promises.mkdir("/tmp");
                    const directory = (await fs.promises.mkdtemp(
                        path.join("/tmp", prefix)
                    )) as string; // Return type mismatch from fs
                    try {
                        return await body(directory);
                    } finally {
                        fs.promises
                            .rm(directory, { force: true, recursive: true })
                            // Ignore any errors that arise as a result of removing the directory
                            .catch(() => {});
                    }
                },
                // Some of the typings in memfs are incompatible with Node's fs module for whatever reason.
                ...(fs.promises as any),
            };
        },
    });
}

/**
 * Creates a new {@link Proxy} that is re-created for each test, but can be accessed as if it was
 * created before the test case. Allows for removing boilerplate in tests:
 *
 *     import { expect } from "chai";
 *
 *     suite("Test Suite", () => {
 *         const proxy = createMochaProxy("something", {
 *             setup() {
 *                 return {
 *                     someProperty: "hello!"
 *                 };
 *             }
 *         });
 *
 *         test('test case', () => {
 *             // The proxy will always be reset back to "hello!" at the start of each test.
 *             expect(proxy).to.have.property("someProperty", "hello!")
 *             proxy.someProperty = "world!";
 *             expect(proxy).to.have.property("someProperty", "world!")
 *         });
 *     });
 *
 * @param name The name of the object being proxied. Will be shown in error messages.
 * @param options Options used to configure the behavior of the proxy.
 * @returns A proxy to an object that is setup and torn down between each test.
 */
export function createMochaProxy<T>(
    name: string,
    options: {
        /** Called to create a new object for each test. */
        setup: () => T;
        /** Called to restore functionality after each test. */
        teardown?: (obj: T) => void;
        /** Override the behavior of the proxy's get() function. */
        get?(target: T, property: string | symbol): any;
        /** Override the behavior of the proxy's set() function. */
        set?(target: T, property: string | symbol, value: any): boolean;
    }
): T {
    let realValue: T | undefined = undefined;
    setup(() => {
        realValue = options.setup();
    });
    teardown(() => {
        if (options.teardown) {
            options.teardown(realValue!);
        }
        realValue = undefined;
    });
    return new Proxy(
        {},
        {
            get(_target, property) {
                if (!realValue) {
                    throw Error(
                        `${name} has not been initialized yet. You can only use it from within a test(), setup(), or teardown() block.`
                    );
                }
                if (!options.get) {
                    return (realValue as any)[property];
                }
                return options.get(realValue, property);
            },
            set(_target, property, value) {
                if (!realValue) {
                    throw Error(
                        `${name} has not been initialized yet. You can only use it from within a test(), setup(), or teardown() block.`
                    );
                }
                if (!options.set) {
                    (realValue as any)[property] = value;
                    return true;
                }
                return options.set(realValue, property, value);
            },
        }
    ) as T;
}

/**
 * Convenience type used to convert a function into a SinonStub
 */
export type MockedFunction<T extends (...args: any[]) => any> = SinonStub<
    Parameters<T>,
    ReturnType<T>
>;

/**
 * Retrieves the parameter types from a class constructor
 */
export type ConstructorParameters<T> = T extends abstract new (...args: infer Arguments) => any
    ? Arguments
    : never;

/**
 * Retrieves the return type from a class constructor
 */
export type ConstructorReturnType<T> = T extends abstract new (...args: any[]) => infer ReturnType
    ? ReturnType
    : never;

/**
 * Convenience type used to convert a class constructor into a SinonStub
 */
export type MockedClass<T extends abstract new (...args: any[]) => any> = SinonStub<
    ConstructorParameters<T>,
    ConstructorReturnType<T>
>;

/**
 * An object that has its functions replaced with SinonStubs.
 */
export type MockedObject<T> = {
    -readonly [K in keyof T]: T[K] extends (...args: any) => any
        ? MockedFunction<T[K]>
        : T[K] extends abstract new (...args: any[]) => any
          ? MockedClass<T[K]>
          : T[K];
};

/**
 * Retrieves the underlying object type of a MockedObject or MockedClass.
 */
export type InstanceOf<T> =
    T extends MockedObject<infer Obj> ? Obj : T extends MockedClass<infer Clazz> ? Clazz : never;

/**
 * Casts the given MockedObject into the same type as the class it is trying to mock.
 *
 * This is only necessary to use when TypeScript complains about missing properties.
 *
 * @param obj The MockedObject
 * @returns The underlying class that the MockedObject is mocking
 */
export function instance<T extends MockedClass<any>>(obj: T): InstanceOf<T>;
export function instance<T extends MockedObject<any>>(obj: T): InstanceOf<T>;
export function instance(mockedObject: any): any {
    return mockedObject;
}

/**
 * Checks whether or not the given object is a stub or spy.
 *
 * @param obj The object to check
 */
function isStub(obj: any): boolean {
    return obj && (obj.displayName === "stub" || obj.displayName === "spy");
}

/**
 * Performs a shallow clone of a given object, replacing its functions with SinonStubs.
 * It will also check to make sure a function is not already a stub before replacing it.
 *
 * @param obj The object to shallow clone
 * @returns The shallow cloned object
 */
function replaceWithMocks<T>(obj: Partial<T>): MockedObject<T> {
    const result: any = {};
    for (const property of Object.getOwnPropertyNames(obj)) {
        try {
            const value = (obj as any)[property];
            if (typeof value === "function" && !isStub(value)) {
                result[property] = stub();
            } else {
                result[property] = value;
            }
        } catch (error) {
            // Certain VSCode internals are locked behind API flags that will
            // throw an error if not set. Hold onto the error and throw it later
            // if this property is actually accessed by the test.
            (error as any)._wasThrownByRealObject = true;
            result[property] = error;
        }
    }
    return result;
}

/**
 * Creates a MockedObject from an interface or class. Converts any functions into SinonStubs.
 *
 *     interface Interface {
 *         num: number;
 *         sum(a: number, b: number): number;
 *     }
 *     const mock = mockObject<Interface<({
 *         num: 4,
 *         sum: mockFn(),
 *     });
 *     mock.sum.returns(17);
 *
 * @param overrides An object containing the properties of the interface or class that will be mocked
 * @returns A MockedObject that contains the same properties as the real interface or class
 */
export function mockObject<T>(overrides: Partial<T>): MockedObject<T> {
    const clonedObject = replaceWithMocks<T>(overrides);
    function checkAndAcquireValueFromTarget(target: any, property: string | symbol): any {
        if (!Object.prototype.hasOwnProperty.call(target, property)) {
            throw new Error(
                `Attempted to access property '${String(property)}', but it was not mocked.`
            );
        }
        const value = target[property];
        if (value && Object.prototype.hasOwnProperty.call(value, "_wasThrownByRealObject")) {
            throw value;
        }
        return value;
    }
    return new Proxy<any>(clonedObject, {
        get(target, property) {
            return checkAndAcquireValueFromTarget(target, property);
        },
        set(target, property, value) {
            checkAndAcquireValueFromTarget(target, property);
            target[property] = value;
            return true;
        },
    });
}

/**
 * Convenience function for use with mockObject() that creates a Sinon stub with the correct arguments
 * and return type.
 *
 *     interface Interface {
 *         sum(a: number, b: number): number;
 *     }
 *     const mock = mockObject<Interface<({
 *         sum: mockFn(s=>s.returns(17)),
 *     });
 *
 * @param stubFunction A function that can be used to add functionality to the SinonStub
 * @returns A Sinon stub for the function
 */
export function mockFn<T extends (...args: any[]) => any>(
    stubFunction?: (_: MockedFunction<T>) => void
): T {
    const result: MockedFunction<T> = stub();
    if (stubFunction) {
        stubFunction(result);
    }
    return result as any;
}

/**
 * Determines whether or not the given type can be converted to a MockedObject
 */
type MockableObject<T> = T extends object
    ? T extends Array<any>
        ? never
        : T extends Set<any>
          ? never
          : T extends Map<any, any>
            ? never
            : T
    : never;

/**
 * Retrieves the keys of an object that can be converted to a MockedObject
 */
type MockableObjectsOf<T> = {
    [K in keyof T]: T[K] extends MockableObject<T[K]> ? K : never;
}[keyof T];

/**
 * Create a new mock for each test that gets cleaned up automatically afterwards. This function makes use of the fact that
 * Mocha's setup() and teardown() methods can be called from anywhere. The resulting object is a proxy to the real
 * mock since it won't be created until the test actually begins.
 *
 * The proxy lets us avoid boilerplate by creating a mock in one line:
 *
 *     import { expect } from "chai";
 *     import * as vscode from "vscode";
 *
 *     suite("Test Suite", () => {
 *         const windowMock = mockGlobalObject(vscode, "window");
 *
 *         test('test case', () => {
 *             vscode.showErrorMessage("Some error message");
 *             expect(windowMock.showErrorMessage).to.have.been.calledWith("Some error message");
 *         });
 *     });
 *
 * **Note:** This **MUST** be called outside of the test() function or it will not work.
 *
 * @param obj The object to create the stub inside
 * @param property The property inside the object to be stubbed
 */
export function mockGlobalObject<T, K extends MockableObjectsOf<T>>(
    obj: T,
    property: K
): MockedObject<T[K]> {
    const originalValue: T[K] = obj[property];
    return createMochaProxy(`Mocked global object '${String(property)}'`, {
        setup() {
            const mockedObject: MockedObject<T[K]> = mockObject(obj[property]);
            Object.defineProperty(obj, property, { value: mockedObject });
            return mockedObject;
        },
        teardown() {
            Object.defineProperty(obj, property, { value: originalValue });
        },
    });
}

function shallowClone<T>(obj: T): T {
    const result: any = {};
    for (const property of Object.getOwnPropertyNames(obj)) {
        result[property] = (obj as any)[property];
    }
    return result;
}

/**
 * Create a new mock for each test that gets cleaned up automatically afterwards. This function makes use of the fact that
 * Mocha's setup() and teardown() methods can be called from anywhere. The resulting object is a proxy to the real
 * mock since it won't be created until the test actually begins.
 *
 * The proxy lets us avoid boilerplate by creating a mock in one line:
 *
 *     import { expect } from "chai";
 *     import * as fs from "fs/promises";
 *
 *     suite("Test Suite", () => {
 *         const fsMock = mockGlobalModule(fs);
 *
 *         test("test case", () => {
 *             fsMock.readFile.resolves("file contents");
 *             await expect(fs.readFile("some_file")).to.eventually.equal("file contents");
 *             expect(fsMock.readFile).to.have.been.calledWith("some_file");
 *         });
 *     });
 *
 * **Note:** This **MUST** be called outside of the test() function or it will not work.
 *
 * @param mod The module that will be fully mocked
 */
export function mockGlobalModule<T>(mod: T): MockedObject<T> {
    const originalValue: T = shallowClone(mod);
    return createMochaProxy("Mocked global module", {
        setup() {
            const mockedModule = mockObject<T>(mod);
            for (const property of Object.getOwnPropertyNames(mockedModule)) {
                try {
                    Object.defineProperty(mod, property, {
                        value: (mockedModule as any)[property],
                        writable: true,
                    });
                } catch {
                    // Some properties of a module just can't be mocked and that's fine
                }
            }
            return mockedModule;
        },
        teardown() {
            for (const property of Object.getOwnPropertyNames(originalValue)) {
                try {
                    Object.defineProperty(mod, property, {
                        value: (originalValue as any)[property],
                    });
                } catch {
                    // Some properties of a module just can't be mocked and that's fine
                }
            }
        },
        // Override get and set to act on the module itself.
        get(_target, property) {
            return (mod as any)[property];
        },
        set(_target, property, value) {
            (mod as any)[property] = value;
            return true;
        },
    });
}

/**
 * Allows setting the constant value.
 */
export interface MockedValue<T> {
    setValue(value: T): void;
}

/**
 * Create a new MockedValue for each test that gets cleaned up automatically afterwards. This function makes use of the
 * fact that Mocha's setup() and teardown() methods can be called from anywhere. The resulting object is a proxy to the
 * real MockedValue since it won't be created until the test actually begins.
 *
 * The proxy lets us avoid boilerplate by creating a mock in one line:
 *
 *     import { expect } from "chai";
 *
 *     suite("Test Suite", () => {
 *         const platformMock = mockGlobalValue(process, "platform");
 *
 *         test("test case", () => {
 *             platformMock.setValue("linux");
 *         });
 *     });
 *
 * **Note:** This **MUST** be called outside of the test() function or it will not work.
 *
 * @param obj The object to create the MockedValue inside
 * @param property The property inside the object to be mocked
 */
export function mockGlobalValue<T, K extends keyof T>(obj: T, property: K): MockedValue<T[K]> {
    let setupComplete: boolean = false;
    const originalValue: T[K] = obj[property];
    // Grab the original value during setup
    setup(() => {
        setupComplete = true;
    });
    // Restore the original value on teardown
    teardown(() => {
        Object.defineProperty(obj, property, { value: originalValue });
        setupComplete = false;
    });
    // Return a ValueMock that allows for easy mocking of the value
    return {
        setValue(value: T[K]): void {
            if (!setupComplete) {
                throw new Error(
                    `Mocked global value '${String(property)}' has not been initialized yet. You can only use it from within a test(), setup(), or teardown() block.`
                );
            }
            Object.defineProperty(obj, property, { value: value });
        },
    };
}

/**
 * Retrieves all properties of an object that are of the type vscode.Event<T>.
 */
type EventsOf<T> = {
    [K in keyof T]: T[K] extends vscode.Event<any> ? K : never;
}[keyof T];

/**
 * Retrieves the type of event given to the generic vscode.Event<T>
 */
export type EventType<T> = T extends vscode.Event<infer E> ? E : never;

/**
 * Create a new AsyncEventEmitter for each test that gets cleaned up automatically afterwards. This function makes use
 * of the fact that Mocha's setup() and teardown() methods can be called from anywhere. The resulting object is a proxy
 * to the real AsyncEventEmitter since it won't be created until the test actually begins.
 *
 * The proxy lets us avoid boilerplate by creating a mock in one line:
 *
 *     import { expect } from "chai";
 *     import { stub } from "sinon";
 *     import * as vscode from "vscode";
 *
 *     suite("Test Suite", () => {
 *         const didStartTask = mockGlobalEvent(vscode.tasks, "onDidStartTask");
 *
 *         test("test case", async () => {
 *             const stubbedListener = stub();
 *             vscode.tasks.onDidStartTask(stubbedListener);
 *
 *             await didStartTask.fire();
 *             expect(stubbedListener).to.have.been.calledOnce;
 *         });
 *     });
 *
 * **Note:** This **MUST** be called outside of the test() function or it will not work.
 *
 * @param obj The object to create the AsyncEventEmitter inside
 * @param property The property inside the object to be mocked
 */
export function mockGlobalEvent<T, K extends EventsOf<T>>(
    obj: T,
    property: K
): AsyncEventEmitter<EventType<T[K]>> {
    const originalValue: T[K] = obj[property];
    return createMochaProxy(`Mocked event '${String(property)}'`, {
        setup() {
            const eventEmitter = new AsyncEventEmitter<EventType<T[K]>>();
            Object.defineProperty(obj, property, { value: eventEmitter.event });
            return eventEmitter;
        },
        teardown() {
            Object.defineProperty(obj, property, { value: originalValue });
        },
    });
}

/**
 * An asynchronous capable version of vscode.EventEmitter that will await
 * returned promises from an event listener.
 */
export class AsyncEventEmitter<T> {
    private listeners: Set<(event: T) => any> = new Set();

    event: vscode.Event<T> = (listener: (event: T) => unknown): vscode.Disposable => {
        this.listeners.add(listener);
        return new vscode.Disposable(() => this.listeners.delete(listener));
    };

    async fire(event: T): Promise<void> {
        for (const listener of this.listeners) {
            await listener(event);
        }
    }
}

/**
 * Returns a new {@link SinonSandbox} that is re-created for each test. This function makes use of the fact that Mocha's
 * setup() and teardown() methods can be called from anywhere. The resulting object is a proxy to the real SinonSandbox
 * since it won't be created until the test actually begins.
 *
 * The proxy lets us avoid boilerplate by creating the sandbox in one line:
 *
 *     import * as vscode from "vscode";
 *
 *     suite("Test Suite", () => {
 *         const sandbox = setupSandboxForTests();
 *
 *         setup(() => {
 *             // We can do anything we want with the sandbox here and it'll be
 *             // restored on teardown().
 *             sandbox.stub(vscode.window, "showQuickPick");
 *         });
 *
 *         // Tests go here...
 *     });
 *
 * **Note:** This **MUST** be called outside of the test() function or it will not work.
 */
export function setupSandboxForTests(): SinonSandbox {
    return createMochaProxy("SinonSandbox", {
        setup() {
            return createSandbox();
        },
        teardown(sandbox) {
            sandbox.restore();
        },
    });
}
