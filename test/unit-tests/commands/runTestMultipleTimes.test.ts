//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import { expect } from "chai";
import { extractTestItemsAndCount } from "../../../src/commands/testMultipleTimes";

suite("Run Tests Multiple Times", () => {
    suite("extractTestItemsAndCount()", () => {
        function createDummyTestItem(label: string): vscode.TestItem {
            return { label } as vscode.TestItem;
        }

        test("handles empty arguments", () => {
            const { testItems, count } = extractTestItemsAndCount();
            expect(testItems).to.deep.equal([]);
            expect(count).to.be.undefined;
        });

        test("handles test items with no count", () => {
            const testItem1 = createDummyTestItem("Test Item 1");
            const testItem2 = createDummyTestItem("Test Item 2");
            const testItem3 = createDummyTestItem("Test Item 3");

            const { testItems, count } = extractTestItemsAndCount(testItem1, testItem2, testItem3);
            expect(testItems).to.deep.equal([testItem1, testItem2, testItem3]);
            expect(count).to.be.undefined;
        });

        test("handles test items with count", () => {
            const testItem1 = createDummyTestItem("Test Item 1");
            const testItem2 = createDummyTestItem("Test Item 2");
            const testItem3 = createDummyTestItem("Test Item 3");

            const { testItems, count } = extractTestItemsAndCount(
                testItem1,
                testItem2,
                testItem3,
                17
            );
            expect(testItems).to.deep.equal([testItem1, testItem2, testItem3]);
            expect(count).to.equal(17);
        });

        test("ignores undefined or null arguments", () => {
            const testItem1 = createDummyTestItem("Test Item 1");
            const testItem2 = createDummyTestItem("Test Item 2");
            const testItem3 = createDummyTestItem("Test Item 3");

            const { testItems, count } = extractTestItemsAndCount(
                testItem1,
                null,
                testItem2,
                testItem3,
                undefined
            );
            expect(testItems).to.deep.equal([testItem1, testItem2, testItem3]);
            expect(count).to.be.undefined;
        });

        test("throws an error if the count is not the last argument", () => {
            const testItem1 = createDummyTestItem("Test Item 1");
            const testItem2 = createDummyTestItem("Test Item 2");

            expect(() => extractTestItemsAndCount(testItem1, 17, testItem2)).to.throw(
                "Unexpected argument 17 at index 1"
            );
        });
    });
});
