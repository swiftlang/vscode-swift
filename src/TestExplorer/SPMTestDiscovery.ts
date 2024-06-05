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

import { TestStyle } from "../sourcekit-lsp/lspExtensions";
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
        const xcTestGroup = /^([\w\d_]*)\.([\w\d_]*)\/(.*)$/.exec(line);
        if (xcTestGroup) {
            targetName = xcTestGroup[1];
            testName = `${xcTestGroup[2]}/${xcTestGroup[3]}`;
            style = "XCTest";
        }

        // Regex "<testTarget>.<testName>"
        const swiftTestGroup = /^([\w\d_]*)\.(.*\(.*\))$/.exec(line);
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
        // Walk the components of the fully qualified name, adding any missing nodes in the tree
        // as we encounter them, and adding to the children of existing nodes.
        components.reduce(
            ({ tests, currentId }, component) => {
                const id = currentId ? `${currentId}${separator}${component}` : component;
                if (currentId) {
                    separator = "/"; // separator starts as . after the tartget name, then switches to / for suites.
                }

                const testStyle: TestStyle = id === targetName ? "test-target" : style;
                let target = tests.find(item => item.id === id);
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
                    tests.push(target);
                }
                return { tests: target.children, currentId: id };
            },
            { tests, currentId: undefined as undefined | string }
        );
    }
    return tests;
}
