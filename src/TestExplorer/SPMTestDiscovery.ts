//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { TestStyle } from "../sourcekit-lsp/extensions";
import { TestClass } from "./TestDiscovery";

/*
 * Build an array of TestClasses from test list output by `swift test list`
 */
export function parseTestsFromSwiftTestListOutput(input: string): TestClass[] {
    const tests = new Array<TestClass>();
    const lines = input.match(/[^\r\n]+/g);
    if (!lines) {
        return tests;
    }

    for (const line of lines) {
        let targetName: string | undefined;
        let testName: string | undefined;
        let style: TestStyle = "XCTest";

        // Regex "<testTarget>.<class>/<function>"
        const xcTestGroup = /^(\w+)\.(\w+)\/(.*)$/.exec(line);
        if (xcTestGroup) {
            targetName = xcTestGroup[1];
            testName = `${xcTestGroup[2]}/${xcTestGroup[3]}`;
        }

        // Regex "<testTarget>.<testName>"
        const swiftTestGroup = /^(\w+)\.(.*\(.*\))$/.exec(line);
        if (swiftTestGroup) {
            targetName = swiftTestGroup[1];
            testName = swiftTestGroup[2];
            style = "swift-testing";
        }

        if (!testName || !targetName) {
            continue;
        }

        const components = [targetName, ...testName.split("/")];
        let separator = ".";
        let currentTests = tests;
        let currentId: string | undefined;
        for (const component of components) {
            const id = currentId ? `${currentId}${separator}${component}` : component;
            if (currentId) {
                separator = "/";
            }

            const testStyle: TestStyle = id === targetName ? "test-target" : style;
            let target = currentTests.find(item => item.id === id);
            if (!target) {
                target = {
                    id,
                    label: component,
                    location: undefined,
                    style,
                    children: [],
                    disabled: false,
                    tags: [{ id: testStyle }],
                };
                currentTests.push(target);
            }
            currentTests = target.children;
            currentId = id;
        }
    }
    return tests;
}
