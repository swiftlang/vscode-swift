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

export function fn(): (...args: any[]) => any {
    return () => {
        throw new Error("Not implemented.");
    };
}

export type MockedFunction<T extends (...args: any[]) => any> = sinon.SinonStub<
    Parameters<T>,
    ReturnType<T>
>;

export type MockedObject<T> = T & {
    -readonly [K in keyof T]: T[K] extends (...args: any[]) => any ? MockedFunction<T[K]> : T[K];
};

function replaceFunctionsWithSinonStubs<T>(obj: Partial<T>): MockedObject<T> {
    const result: any = {};
    for (const property of Object.getOwnPropertyNames(obj)) {
        if (typeof (obj as any)[property] === "function") {
            result[property] = sinon.stub();
        } else {
            result[property] = (obj as any)[property];
        }
    }
    return result;
}

function makeProxyObject<T>(obj: MockedObject<T>): MockedObject<T> {
    return new Proxy<any>(obj, {
        get(target, property) {
            if (!Object.prototype.hasOwnProperty.call(target, property)) {
                throw new Error("Attempted to access a property that was not mocked.");
            }
            return target[property];
        },
        set(target, property, value) {
            if (!Object.prototype.hasOwnProperty.call(target, property)) {
                throw new Error("Attempted to access a property that was not mocked.");
            }
            if (typeof target[property] === "function") {
                throw new Error("Cannot set the value of a function property in a mocked object");
            }
            target[property] = value;
            return true;
        },
    });
}

export function mockObject<T>(overrides: Partial<T>): MockedObject<T> {
    const clonedObject = replaceFunctionsWithSinonStubs<T>(overrides);
    return makeProxyObject<T>(clonedObject);
}

type ObjectsOf<T> = {
    [K in keyof T]: T[K] extends object ? K : never;
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
export function mockNamespace<T, K extends ObjectsOf<T>>(obj: T, property: K): MockedObject<T[K]> {
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
): vscode.EventEmitter<EventType<T[K]>> {
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
    return new Proxy(new vscode.EventEmitter(), {
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
