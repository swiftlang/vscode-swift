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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { setup, teardown } from "mocha";
import { Disposable, Event, EventEmitter } from "vscode";
import { instance, mock, when } from "ts-mockito";
import { MethodToStub } from "ts-mockito/lib/MethodToStub";

export function getMochaHooks(): { setup: typeof setup; teardown: typeof teardown } {
    if (!("setup" in global && "teardown" in global)) {
        throw new Error("MockUtils can only be used when running under mocha");
    }
    return {
        setup: global.setup,
        teardown: global.teardown,
    };
}

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
export function mockNamespace<T, K extends keyof T>(obj: T, property: K): T[K] {
    let realMock: T[K];
    const originalValue: T[K] = obj[property];
    const mocha = getMochaHooks();
    // Create the mock at setup
    mocha.setup(() => {
        realMock = mock<T[K]>();
        Object.defineProperty(obj, property, { value: instance(realMock) });
    });
    // Restore original value at teardown
    mocha.teardown(() => {
        Object.defineProperty(obj, property, { value: originalValue });
    });
    // Return the proxy to the real mock
    return new Proxy(originalValue, {
        get: (target: any, property: string): any => {
            if (!realMock) {
                throw Error("Mock proxy accessed before setup()");
            }
            return (realMock as any)[property];
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        set: (target: any, property: string, value: any): boolean => {
            // Ignore
            return true;
        },
    });
}

/** Retrieves the type of event given to the generic vscode.Event<T> */
export type EventType<T> = T extends Event<infer E> ? E : never;

/** The listener function that receives events. */
export type Listener<T> = T extends Event<infer E> ? (e: E) => any : never;

/** Allows sending an event to all intercepted listeners. */
export interface ListenerInterceptor<T> {
    onDidAddListener: Event<(event: T) => any>;

    /** Send an event notification to the intercepted listener(s). */
    notifyAll(event: T): Promise<void>;
}

class ListenerInterceptorImpl<T> implements ListenerInterceptor<T> {
    private listeners: ((event: T) => any)[];
    private _onDidChangeListeners: EventEmitter<(event: T) => any>;

    constructor() {
        this.listeners = [];
        this._onDidChangeListeners = new EventEmitter();
        this.onDidAddListener = this._onDidChangeListeners.event;
    }

    async notifyAll(event: T): Promise<void> {
        await Promise.all(this.listeners.map(async listener => await listener(event)));
    }

    addListener: Event<T> = (listener, thisArgs) => {
        if (thisArgs) {
            listener = listener.bind(thisArgs);
        }
        this.listeners.push(listener);
        this._onDidChangeListeners.fire(listener);
        return { dispose: () => mock(Disposable) };
    };

    onDidAddListener: Event<(event: T) => any>;
}

/** Retrieves all properties of an object that are of the type vscode.Event<T>. */
type EventsOf<T> = {
    [K in keyof T]: T[K] extends Event<any> ? K : never;
}[keyof T];

/**
 * Create a ListenerInterceptor that intercepts all listeners attached to a VS Code event function. This function stubs out the
 * given method during Mocha setup and restores it during teardown.
 *
 * This lets us avoid boilerplate by creating an interceptor in one line:
 *
 *     const interceptor = eventListenerMock(vscode.workspace, 'onDidChangeWorkspaceFolders');
 *
 *     test('Some test', () => {
 *       interceptor.notify(event);
 *     })
 *
 * @param obj The object to create the stub inside
 * @param method The name of the method to stub within the object. Must be of the type Event<any>.
 */
export function eventListenerMock<T, K extends EventsOf<T>>(
    obj: T,
    method: K
): ListenerInterceptor<EventType<T[K]>> {
    const mocha = getMochaHooks();
    let interceptor: ListenerInterceptorImpl<EventType<T[K]>>;
    let originalValue: T[K];
    mocha.setup(() => {
        interceptor = new ListenerInterceptorImpl<EventType<T[K]>>();
        originalValue = obj[method];
        if (originalValue instanceof MethodToStub) {
            when(originalValue).thenReturn(interceptor.addListener as any);
        } else {
            Object.defineProperty(obj, method, { value: interceptor.addListener });
        }
    });
    // Restore original value at teardown
    mocha.teardown(() => {
        if (!(obj[method] instanceof MethodToStub)) {
            Object.defineProperty(obj, method, { value: originalValue });
        }
    });
    // Return the proxy to the interceptor
    return new Proxy(
        {},
        {
            get: (target: any, property: string): any => {
                if (!interceptor) {
                    throw Error("Interceptor proxy accessed before setup()");
                }
                return (interceptor as any)[property];
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            set: (target: any, property: string, value: any): boolean => {
                // Ignore
                return true;
            },
        }
    );
}

/**
 * Allows setting the constant value.
 */
export interface ValueMock<T> {
    setValue(value: T): void;
}

/**
 * Create a new ValueMock that is restored after a test completes.
 */
export function mockValue<T, K extends keyof T>(obj: T, property: K): ValueMock<T[K]> {
    let setupComplete: boolean = false;
    let originalValue: T[K];
    const mocha = getMochaHooks();
    // Grab the original value during setup
    mocha.setup(() => {
        originalValue = obj[property];
        setupComplete = true;
    });
    // Restore the original value on teardown
    mocha.teardown(() => {
        Object.defineProperty(obj, property, { value: originalValue });
        setupComplete = false;
    });
    // Return a ValueMock that allows for easy mocking of the value
    return {
        setValue(value: T[K]): void {
            if (!setupComplete) {
                throw new Error(
                    `'${String(property)}' cannot be set before mockValue() completes its setup through Mocha`
                );
            }
            Object.defineProperty(obj, property, { value: value });
        },
    };
}

type Constructor<T> = T extends abstract new (...args: any) => any ? T : never;
type Instance<T> = InstanceType<Constructor<T>>;

export function mockConstructor<T, K extends keyof T>(obj: T, property: K): Instance<T[K]> {
    const clazz = obj[property] as Constructor<T[K]>;
    let realMock: Instance<T[K]>;

    // Replace constructor with a proxy that returns mock instance
    const classValueMock = mockValue(obj, property);
    const mocha = getMochaHooks();
    mocha.setup(() => {
        realMock = mock(clazz);
        classValueMock.setValue(
            new Proxy(clazz, {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                construct(target) {
                    return instance(realMock) as object;
                },
            }) as T[K]
        );
    });

    // Return the proxy to the real mock
    return new Proxy(
        {},
        {
            get: (target: any, property: string): any => {
                if (!realMock) {
                    throw Error("Mock proxy accessed before setup()");
                }
                return (realMock as any)[property];
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            set: (target: any, property: string, value: any): boolean => {
                // Ignore
                return true;
            },
        }
    );
}
