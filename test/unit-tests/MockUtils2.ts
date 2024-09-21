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
import * as vscode from "vscode";
import * as sinon from "sinon";

/**
 * A convenience function for reducing boilerplate in calls to mockObject().
 *
 * Returns a function that does nothing:
 *
 *     const mockedObject = mockObject<SomeInterface>({
 *         fn1: doNothing(),
 *         fn2: doNothing(),
 *         fn3: doNothing(),
 *     });
 * */
export function doNothing(): (...args: any) => any {
    return () => {};
}

export type MockedFunction<T extends (...args: any) => any> = sinon.SinonStub<
    Parameters<T>,
    ReturnType<T>
>;

export type MockedObject<T> = {
    -readonly [K in keyof T]: T[K] extends (...args: any) => any
        ? MockedFunction<T[K]>
        : T[K] extends abstract new (...args: any[]) => any
          ? MockedClass<T[K]>
          : T[K];
};

export type InstanceOf<T> =
    T extends MockedObject<infer Obj> ? Obj : T extends MockedClass<infer Clazz> ? Clazz : never;

/**
 * Casts the given MockedObject into the same type as the class it is trying to mock.
 *
 * This is only necessary when trying to mock a class that contains private properties.
 *
 * @param obj The MockedObject
 * @returns The underlying class that the MockedObject is mocking
 */
export function instance<T extends MockedClass<any>>(obj: T): InstanceOf<T>;
export function instance<T extends MockedObject<any>>(obj: T): InstanceOf<T>;
export function instance(obj: any): any {
    return obj;
}

function replaceWithMocks<T>(obj: Partial<T>): MockedObject<T> {
    const result: any = {};
    for (const property of Object.getOwnPropertyNames(obj)) {
        try {
            const value = (obj as any)[property];
            if (typeof value === "function") {
                result[property] = sinon.stub();
            } else {
                result[property] = value;
            }
        } catch (error) {
            // Certain VSCode internals are locked behind API flags that will
            // throw an error if not set. Hang onto the error and throw it later
            // if this property is actually accessed by the test.
            (error as any)._wasThrownByRealObject = true;
            result[property] = error;
        }
    }
    return result;
}

function makeProxyObject<T>(obj: MockedObject<T>): MockedObject<T> {
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
    return new Proxy<any>(obj, {
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
 * Creates a MockedObject from an interface or class. Converts any functions to Sinon stubs.
 *
 * @param overrides An object containing the properties of the interface or class that will be mocked
 * @returns A MockedObject that contains the same properties as the real interface or class
 */
export function mockObject<T>(overrides: Partial<T>): MockedObject<T> {
    const clonedObject = replaceWithMocks<T>(overrides);
    return makeProxyObject<T>(clonedObject);
}

export type ConstructorArgumentsOf<T> = T extends abstract new (...args: infer Arguments) => any
    ? Arguments
    : never;

export type MockedClass<T extends abstract new (...args: any) => any> = sinon.SinonStub<
    ConstructorArgumentsOf<T>,
    InstanceType<T>
>;

export function mockClass<T extends abstract new (...args: any) => any>(): MockedClass<T> {
    return sinon.stub<ConstructorArgumentsOf<T>, InstanceType<T>>();
}

export async function waitForReturnedPromises(
    mockedFn: MockedFunction<(...args: any) => Thenable<any>>
): Promise<void> {
    for (const promise in mockedFn.returnValues) {
        await promise;
    }
}

/**
 * Convenience function that creates a Sinon stub with the correct arguments and return type.
 *
 * @returns A Sinon stub for the function
 */
export function mockFn<T extends (...args: any[]) => any>(): MockedFunction<T> {
    return sinon.stub();
}

type MockableObject<T> = T extends object
    ? T extends Array<any>
        ? never
        : T extends Set<any>
          ? never
          : T extends Map<any, any>
            ? never
            : T
    : never;

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
 *     const windowMock = mockNamespace(vscode, "window");
 *
 *     test('Some test', () => {
 *       expect(windowMock.showErrorMessage).to.have.been.calledWith('Some error message');
 *     })
 *
 * @param obj The object to create the stub inside
 * @param property The method inside the object to be stubbed
 */
export function mockNamespace<T, K extends MockableObjectsOf<T>>(
    obj: T,
    property: K
): MockedObject<T[K]> {
    let realMock: MockedObject<T[K]>;
    const originalValue: T[K] = obj[property];
    // Create the mock at setup
    setup(() => {
        realMock = mockObject(obj[property]);
        Object.defineProperty(obj, property, { value: realMock });
    });
    // Restore original value at teardown
    teardown(() => {
        Object.defineProperty(obj, property, { value: originalValue });
    });
    // Return the proxy to the real mock
    return new Proxy<any>(originalValue, {
        get(target, property) {
            if (!realMock) {
                throw Error("Mock proxy accessed before setup()");
            }
            return (realMock as any)[property];
        },
        set(target, property, value) {
            (realMock as any)[property] = value;
            return true;
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

export function mockModule<T>(mod: T): MockedObject<T> {
    let realMock: MockedObject<T>;
    const originalValue: T = shallowClone(mod);
    // Create the mock at setup
    setup(() => {
        realMock = mockObject(mod);
        for (const property of Object.getOwnPropertyNames(realMock)) {
            try {
                Object.defineProperty(mod, property, {
                    value: (realMock as any)[property],
                    configurable: true,
                });
            } catch {
                // Some properties of a module just can't be mocked and that's fine
            }
        }
    });
    // Restore original value at teardown
    teardown(() => {
        for (const property of Object.getOwnPropertyNames(originalValue)) {
            try {
                Object.defineProperty(mod, property, {
                    value: (originalValue as any)[property],
                    configurable: true,
                });
            } catch {
                // Some properties of a module just can't be mocked and that's fine
            }
        }
    });
    // Return the proxy to the real mock
    return new Proxy<any>(originalValue, {
        get(target, property) {
            if (!realMock) {
                throw Error("Mock proxy accessed before setup()");
            }
            return (realMock as any)[property];
        },
        set(target, property, value) {
            (realMock as any)[property] = value;
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
 * Create a new ValueMock that is restored after a test completes.
 */
export function mockValue<T, K extends keyof T>(obj: T, property: K): MockedValue<T[K]> {
    let setupComplete: boolean = false;
    let originalValue: T[K];
    // Grab the original value during setup
    setup(() => {
        originalValue = obj[property];
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
                throw new Error("Mocks cannot be accessed outside of test functions");
            }
            Object.defineProperty(obj, property, { value: value });
        },
    };
}

/** Retrieves all properties of an object that are of the type vscode.Event<T>. */
type EventsOf<T> = {
    [K in keyof T]: T[K] extends vscode.Event<any> ? K : never;
}[keyof T];

/** Retrieves the type of event given to the generic vscode.Event<T> */
export type EventType<T> = T extends vscode.Event<infer E> ? E : never;

export function mockEventEmitter<T, K extends EventsOf<T>>(
    obj: T,
    property: K
): AsyncEventEmitter<EventType<T[K]>> {
    let eventEmitter: vscode.EventEmitter<EventType<T[K]>>;
    const originalValue: T[K] = obj[property];
    // Create the mock at setup
    setup(() => {
        eventEmitter = new vscode.EventEmitter();
        Object.defineProperty(obj, property, { value: eventEmitter.event });
    });
    // Restore original value at teardown
    teardown(() => {
        Object.defineProperty(obj, property, { value: originalValue });
    });
    // Return the proxy to the EventEmitter
    return new Proxy(new AsyncEventEmitter(), {
        get(target, property) {
            if (!eventEmitter) {
                throw Error("Mock proxy accessed before setup()");
            }
            return (eventEmitter as any)[property];
        },
        set(target, property, value) {
            (eventEmitter as any)[property] = value;
            return true;
        },
    });
}

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
