# Writing Tests for the VS Code Swift Extension <!-- omit in toc -->

This document provides guidance to contributors on how to write test cases for contributions to the [VSCode Swift extension](https://github.com/swiftlang/vscode-swift) using **Mocha**, **Chai**, and **Sinon**. These tools are widely used for testing JavaScript/TypeScript code and will help ensure that your code is reliable and maintainable.

A brief description of each framework can be found below:

-   [**Mocha**](https://mochajs.org/): A JavaScript test framework that runs in Node.js. It provides structure for writing test suites, hooks (e.g., `setup()`, `teardown()`), and test cases (`test()`).
-   [**Chai**](https://www.chaijs.com/): An assertion library. It allows you to express expectations for your code’s behavior using natural language.
-   [**Sinon**](https://sinonjs.org/): A powerful mocking and spying library that allows you to create spies, stubs, and mocks to test how your code interacts with other components.

## Overview <!-- omit in toc -->

- [Organizing Tests](#organizing-tests)
- [Writing Unit Tests](#writing-unit-tests)
- [Mocking the File System](#mocking-the-file-system)
- [Mocking Utilities](#mocking-utilities)
  - [Mocking interfaces, classes, and functions](#mocking-interfaces-classes-and-functions)
  - [Mocking VS Code events](#mocking-vs-code-events)
  - [Mocking global modules](#mocking-global-modules)
    - [Mocking global objects](#mocking-global-objects)
    - [Mocking global events](#mocking-global-events)
    - [Setting global constants](#setting-global-constants)
    - [Mocking an entire module](#mocking-an-entire-module)
- [Conclusion](#conclusion)

## Organizing Tests

Tests are currently organized into one of two directories:

1. **Unit Tests** - Tests that exercise smaller units of code go in `test/unit-tests`
2. **Integration Tests** - Tests that exercise more complicated features that require the extension to be loaded in VSCode go in `test/integration-tests`

There are plans to add a third set of smoke tests that will have no mocking at all and actually click through the VS Code user interface to perform actions. For more information see the [Swift for Visual Studio Code test strategy](./test-strategy.md) document.

## Writing Unit Tests

> [!NOTE]
> This section will guide you through contributing a simple test that mocks out some VS Code UI pieces. For more information on individual mocking methods, see the [Mocking Utilties](#mocking-utilities) section.

Unit tests should be organized in a way that reflects the structure of the project. For example, let's say you were writing unit tests for the [`showReloadExtensionNotification()`](../../src/ui/ReloadExtension.ts) function under `src/ui/ReloadExtensions.ts`. You would want to first create a unit test file that mirrors the structure of that feature’s implementation:

1. **Create a new test file** `test/unit-tests/ui/ReloadExtensions.ts` that will contain the test suite:

    ```
    test/unit-tests/ui/
      |- ReloadExtensions.test.ts
    ```

2. **Structure your test suite** using Mocha’s `suite()` function. This function allows you to group related tests together logically.

    ```typescript
    suite("ReloadExtension Unit Test Suite", function () {
        // Individual test cases will go here
    });
    ```

3. **Create your first test case** using Mocha's `test()` function. Your test name should clearly explain what the test is trying to verify.
    ```typescript
    suite("ReloadExtension Unit Test Suite", () => {
        test("displays a warning message asking the user to reload the window", async () => {
            // Test code goes here
        });
    });
    ```

Now comes the fun part! For unit testing we use [Chai](https://chaijs.com) for assertions and [Sinon](https://sinonjs.org/) for stubbing/mocking user interaction and observing behaviour that is otherwise difficult to observe. Many helpful utility functions exist in [MockUtils.ts](../../test/MockUtils.ts). These utility methods take care of the setup and teardown of the mocks so the developer does not need to remember to do this for each suite/test.

Our test is going to want to verify that a warning message is shown to the user. For this, we'll want to mock out VSCodes global `window` module. Thankfully, MockUtils contains a `mockGlobalObject` function that will replace a global object with a mocked version. Each property is replaced with a Sinon stub during setup and restored at teardown. Keep in mind that the `mockGlobal*` functions all need to be created at the **`suite()`** level. Unexpected behavior will occur if called within a `test()` function.

```typescript
import { expect } from "chai";
import { mockGlobalObject } from "../../MockUtils";
import * as vscode from "vscode";
import { showReloadExtensionNotification } from "../../../src/ui/ReloadExtension";

suite("ReloadExtension Unit Test Suite", () => {
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");

    test("displays a warning message asking the user if they would like to reload the window", async () => {
        // Define the mock behavior using methods on the Sinon stub
        mockedVSCodeWindow.showWarningMessage.resolves(undefined);
        // Execute the function that we're testing
        await showReloadExtensionNotification("Want to reload?");
        // Make sure that the warning was shown correctly
        expect(mockedVSCodeWindow.showWarningMessage).to.have.been.calledOnceWithExactly(
            "Want to reload?",
            "Reload Extensions"
        );
    });
});
```

Now let's test to see what happens when the user clicks the "Reload Extensions" button. VS Code provides a command to reload the window which will cause the extension to reload. We can verify that this command is executed:

```typescript
suite("ReloadExtension Unit Test Suite", () => {
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");
    const mockedVSCodeCommands = mockGlobalObject(vscode, "commands");

    // ... previous test case(s) here

    test("reloads the extension if the user clicks the 'Reload Extensions' button", async () => {
        // Define the mock behavior using methods on the Sinon stub
        mockedVSCodeWindow.showWarningMessage.resolves("Reload Extensions" as any);
        // Execute the function that we're testing
        await showReloadExtensionNotification("Want to reload?");
        // Make sure that the extension was reloaded
        expect(mockedVSCodeCommands.executeCommand).to.have.been.calledOnceWithExactly(
            "workbench.action.reloadWindow"
        );
    });
});
```

You may have also noticed that we needed to cast the `"Reload Extensions"` string to `any` when resolving `showWarningMessage()`. Unforunately, this may be necessary for methods that have incompatible overloaded signatures due to a TypeScript issue that remains unfixed.

## Mocking the File System

The [`mock-fs`](https://github.com/tschaub/mock-fs) module can be used to temporarily replace Node's built-in `fs` module with an in-memory file system. This can be useful for testing logic that uses the `fs` module without actually reaching out to the file system. Just make sure that you add a `teardown()` block that restores the `fs` module after each test:

```typescript
import * as chai from "chai";
import * as mockFS from "mock-fs";
import * as fs from "fs/promises";

suite("mock-fs example", () => {
    teardown(() => {
        mockFS.restore();
    });

    test("mock out a file on disk", async () => {
        mockFS({
            "/path/to/some/file": "Some really cool file contents",
        });
        await expect(fs.readFile("/path/to/some/file", "utf-8"))
            .to.eventually.equal("Some really cool file contents");
    });
});
```

## Mocking Utilities

This section outlines the various utilities that can be used to improve the readability of your tests. The [MockUtils](../../test/MockUtils.ts) module can be used to perform more advanced mocking than what Sinon provides out of the box. This module has its [own set of tests](../../test/unit-tests/MockUtils.test.ts) that you can use to get a feel for how it works.

### Mocking interfaces, classes, and functions

If you need a one-off mock of an Interface or Class that you can configure the behavior of, use `mockObject()`. This function requires a type parameter of the Interface or Class you're mocking as well as an object containing the properties you would like to mock. You can use this in combination with `mockFn()` to fully mock an object and define its default behavior in one line:

```typescript
import { expect } from "chai";
import { mockFn, mockObject } from "../MockUtils";

interface TestInterface {
    first: number;
    second: number;
    sum(): number;
}

test("can mock an interface", () => {
    const mockedInterface = mockObject<TestInterface>({
        first: 0,
        second: 0,
        sum: mockFn(s => s.callsFake(() => {
            return mockedInterface.first + mockedInterface.second;
        }));
    });

    mockedInterface.first = 17;
    mockedInterface.second = 13;
    expect(mockedInterface.sum()).to.equal(30);
});
```

Sometimes you will need to use the `instance()` method to convert from a MockedObject to the actual object. This is purely to avoid TypeScript errors and should only be necessary when dealing with complex types (E.g. a class with private properties):

```typescript
import { expect } from "chai";
import { mockFn, mockObject, instance } from "../MockUtils";

class TestClass {
    private first: number;
    private second: number;

    constructor(first: number, second: number) {
        this.first = first;
        this.second = second;
    }

    sum(): number {
        return this.first + this.second;
    }
}

function sumOfTestClass(test: TestClass): number {
    return test.sum();
}


test("can mock a class with private properties", () => {
    const mockedClass = mockObject<TestClass>({
        sum: mockFn();
    });

    mockedClass.sum.returns(42);
    expect(sumOfTestClass(instance(mockedInterface))).to.equal(42);
});
```

### Mocking VS Code events

The `AsyncEventEmitter` captures components listening for a given event and fires the event emitter with the provided test data:

```typescript
import { expect } from "chai";
import { mockObject, AsyncEventEmitter } from "../MockUtils";
import * as vscode from "vscode";

interface TestInterface {
    onDidGetNumber: vscode.Event<number>;
}

test("example of mocking an asynchronous event within a mocked object", async () => {
    // Create a new AsyncEventEmitter and hook it up to the mocked interface
    const emitter = new AsyncEventEmitter<number>();
    const mockedInterface = mockObject<TestInterface>({
        onDidGetNumber: mockFn(s => s.callsFake(emitter.event));
    });

    // A simple example of an asynchronous event handler
    const events: number[] = [];
    mockedInterface.onDidGetNumber(async num => {
        await new Promise<void>(resolve => {
            setTimeout(resolve, 1);
        });
        events.push(num);
    });

    // Use the fire() method to trigger events
    await emitter.fire(1);
    await emitter.fire(2);
    await emitter.fire(3);

    // Make sure that the events were triggered correctly
    expect(events).to.deep.equal([1, 2, 3]);
});
```

### Mocking global modules

Sometimes it is necessary to mock behavior that is provided by modules. A prime example of this is the VS Code API. In these cases you can use the global variants of the previously mentioned functions.

These global mocking functions automatically handle `setup()` and `teardown()` through Mocha so that you don't have to do this yourself. The only caveat is that the global methods must be called at the `suite()` level rather than inside a `test()` case:

```typescript
import { expect } from "chai";
import { mockGlobalObject } from "../MockUtils";
import * as vscode from "vscode";

suite("Mocking a Global Interface", async function () {
    // Runs Mocha's setup() and teardown() functions to stub out vscode.window automatically
    // Notice how this is a constant defined at the root of the suite() and not in test()
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");

    test("define behavior for a global function", async () => {
        mockedVSCodeWindow.showInformationMessage.resolves(undefined);

        // ... trigger and verify behavior
    });
});
```

#### Mocking global objects

`MockUtils` contains a method called `mockGlobalObject()` that can be used to mock an object that is part of a module:

```typescript
import { expect } from "chai";
import { mockGlobalObject } from "../MockUtils";
import * as vscode from "vscode";

suite("Mocking a Global Interface", async function () {
    const mockedVSCodeWindow = mockGlobalObject(vscode, "window");

    test("define behavior for a global function", async () => {
        mockedVSCodeWindow.showInformationMessage.resolves(undefined);

        // ... trigger and verify behavior
    });
});
```

#### Mocking global events

You may also want to mock a global event from the VS Code API using the `mockGlobalEvent()` function:

```typescript
import { expect } from "chai";
import { mockObject, mockGlobalEvent } from "../MockUtils";
import * as vscode from "vscode";

suite("Global event example", async function () {
    const didStartTask = mockGlobalEvent(vscode.tasks, "onDidStartTask");

    test("fire an event for onDidStartTask", async () => {
        // Fire the onDidStartTask event
        const mockedTask = mockObject<vscode.Task>({});
        mockedTaskExecution = { task: instance(mockedTask), terminate: () => {} };
        await didStartTask.fire({ execution: mockedTaskExecution });

        // ... verify behavior
    });
});
```

#### Setting global constants

The `mockGlobalValue()` function allows for temporarily overriding the value for some global constant:

```typescript
import { mockGlobalValue } from "../MockUtils";

suite("Process platform example", async function () {
    const processPlatform = mockGlobalValue(process, "platform")

    test("simulate being on Linux", async () => {
        processPlatform.setValue("linux");

        // ... trigger and verify behavior
    });
});
```

#### Mocking an entire module

The `mockGlobalModule()` function allows for mocking an entire module such as our internal `configuration` module:

```typescript
import * as configuration from "../../src/configuration.ts";

suite("Mocked configuration example", async function () {
    const mockedConfiguration = mockGlobalModule(configuration);

    test("simulate the user setting the path to swift in their settings", async () => {
        mockedConfiguration.path = "/path/to/swift";

        // ... trigger and verify behavior
    });
});
```

## Conclusion

Writing clear and concise test cases is critical to ensuring the robustness of your contributions. By following the steps outlined in this document, you can create tests that are easy to understand, maintain, and extend.

Thank you for contributing to the Swift extension for VS Code!
