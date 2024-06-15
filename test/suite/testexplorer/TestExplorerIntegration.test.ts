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
import * as assert from "assert";
import { beforeEach } from "mocha";
import { testAssetUri } from "../../fixtures";
import { globalWorkspaceContextPromise } from "../extension.test";
import { TestExplorer } from "../../../src/TestExplorer/TestExplorer";
import {
    assertTestControllerHierarchy,
    assertTestResults,
    eventPromise,
    getTestItem,
    syncPromise,
} from "./utilities";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { TestRunProxy } from "../../../src/TestExplorer/TestRunner";
import { Version } from "../../../src/utilities/version";
import { TestKind } from "../../../src/TestExplorer/TestKind";

suite("Test Explorer Suite", function () {
    const MAX_TEST_RUN_TIME_MINUTES = 5;

    this.timeout(1000 * 60 * MAX_TEST_RUN_TIME_MINUTES);

    let workspaceContext: WorkspaceContext;
    let testExplorer: TestExplorer;

    async function waitForTestExplorerReady(): Promise<vscode.TestController> {
        return (
            await Promise.all([
                testExplorer.controller.items.size === 0
                    ? eventPromise(testExplorer.onTestItemsDidChange)
                    : Promise.resolve(testExplorer.controller),
                syncPromise(() => vscode.commands.executeCommand("workbench.view.testing.focus")),
            ])
        )[0];
    }

    async function runTest(
        controller: vscode.TestController,
        runProfile: TestKind,
        ...tests: string[]
    ): Promise<TestRunProxy> {
        const targetProfile = testExplorer.testRunProfiles.find(
            profile => profile.label === runProfile
        );
        if (!targetProfile) {
            throw new Error(`Unable to find run profile named ${runProfile}`);
        }

        const testItems = tests.map(test => {
            const testItem = getTestItem(controller, test);
            if (!testItem) {
                const testsInController: string[] = [];
                controller.items.forEach(item => {
                    testsInController.push(
                        `${item.id}: ${item.label} ${item.error ? `(error: ${item.error})` : ""}`
                    );
                });

                assert.fail(
                    `Unable to find ${test} in Test Controller. Items in test controller are: ${testsInController.join(", ")}`
                );
            }
            assert.ok(testItem);
            return testItem;
        });

        const request = new vscode.TestRunRequest(testItems);

        return (
            await Promise.all([
                eventPromise(testExplorer.onCreateTestRun),
                targetProfile.runHandler(request, new vscode.CancellationTokenSource().token),
            ])
        )[0];
    }

    suiteSetup(async () => {
        workspaceContext = await globalWorkspaceContextPromise;
    });

    beforeEach(async () => {
        const packageFolder = testAssetUri("defaultPackage");
        const targetFolder = workspaceContext.folders.find(
            folder => folder.folder.path === packageFolder.path
        );
        if (!targetFolder || !targetFolder.testExplorer) {
            throw new Error("Unable to find test explorer");
        }
        testExplorer = targetFolder.testExplorer;

        // Set up the listener before bringing the text explorer in to focus,
        // which starts searching the workspace for tests.
        await waitForTestExplorerReady();
    });

    test("Finds Tests", async function () {
        if (workspaceContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))) {
            // 6.0 uses the LSP which returns tests in the order they're declared.
            // Includes swift-testing tests.
            assertTestControllerHierarchy(testExplorer.controller, [
                "PackageTests",
                [
                    "PassingXCTestSuite",
                    ["testPassing()"],
                    "PassingXCTestSuite2",
                    ["testPassing()"],
                    "FailingXCTestSuite",
                    ["testFailing()"],
                    "MixedXCTestSuite",
                    ["testPassing()", "testFailing()"],
                    "DebugReleaseTestSuite",
                    ["testRelease()", "testDebug()"],
                    "topLevelTestPassing()",
                    "topLevelTestFailing()",
                    "parameterizedTest(_:)",
                    "testRelease()",
                    "testDebug()",
                    "MixedSwiftTestingSuite",
                    ["testPassing()", "testFailing()", "testDisabled()"],
                    "testWithKnownIssue()",
                    "testWithKnownIssueAndUnknownIssue()",
                ],
            ]);
        } else if (workspaceContext.swiftVersion.isLessThanOrEqual(new Version(5, 10, 0))) {
            // 5.10 uses `swift test list` which returns test alphabetically, without the round brackets.
            // Does not include swift-testing tests.
            assertTestControllerHierarchy(testExplorer.controller, [
                "PackageTests",
                [
                    "DebugReleaseTestSuite",
                    ["testDebug", "testRelease"],
                    "FailingXCTestSuite",
                    ["testFailing"],
                    "MixedXCTestSuite",
                    ["testFailing", "testPassing"],
                    "PassingXCTestSuite",
                    ["testPassing"],
                    "PassingXCTestSuite2",
                    ["testPassing"],
                ],
            ]);
        }
    });

    suite("swift-testing", () => {
        suiteSetup(function () {
            if (workspaceContext.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                this.skip();
            }
        });

        test("withKnownIssue", async () => {
            const testRun = await runTest(
                testExplorer.controller,
                TestKind.standard,
                "PackageTests.testWithKnownIssue()"
            );

            assertTestResults(testRun, {
                skipped: ["PackageTests.testWithKnownIssue()"],
            });
        });

        test("testWithKnownIssueAndUnknownIssue", async () => {
            const testRun = await runTest(
                testExplorer.controller,
                TestKind.standard,
                "PackageTests.testWithKnownIssueAndUnknownIssue()"
            );

            assertTestResults(testRun, {
                failed: [
                    {
                        test: "PackageTests.testWithKnownIssueAndUnknownIssue()",
                        issues: ["Expectation failed: 2 == 3"],
                    },
                ],
            });
        });

        test("tests run in debug mode @slow", async function () {
            const testRun = await runTest(
                testExplorer.controller,
                TestKind.standard,
                "PackageTests.testDebug()"
            );

            assertTestResults(testRun, {
                passed: ["PackageTests.testDebug()"],
            });
        });

        test("test run in release mode @slow", async function () {
            // Building in release takes a long time.
            this.timeout(1000 * 60 * MAX_TEST_RUN_TIME_MINUTES * 2);

            const passingRun = await runTest(
                testExplorer.controller,
                TestKind.release,
                "PackageTests.testRelease()"
            );
            assertTestResults(passingRun, {
                passed: ["PackageTests.testRelease()"],
            });

            const failingRun = await runTest(
                testExplorer.controller,
                TestKind.standard,
                "PackageTests.testRelease()"
            );

            assertTestResults(failingRun, {
                failed: [
                    {
                        test: "PackageTests.testRelease()",
                        issues: ["Unconditionally failed", "Test was run in debug mode."],
                    },
                ],
            });
        });
    });

    suite("XCTest", () => {
        test("tests run in debug mode @slow", async function () {
            const testRun = await runTest(
                testExplorer.controller,
                TestKind.standard,
                "PackageTests.DebugReleaseTestSuite/testDebug"
            );

            assertTestResults(testRun, {
                passed: ["PackageTests.DebugReleaseTestSuite/testDebug"],
            });
        });

        test("tests run in release mode @slow", async function () {
            // Building in release takes a long time.
            this.timeout(1000 * 60 * MAX_TEST_RUN_TIME_MINUTES * 2);

            const passingRun = await runTest(
                testExplorer.controller,
                TestKind.release,
                "PackageTests.DebugReleaseTestSuite/testRelease"
            );

            assertTestResults(passingRun, {
                passed: ["PackageTests.DebugReleaseTestSuite/testRelease"],
            });
        });
    });

    // Do coverage last as it does a full rebuild, causing the stage after it to have to rebuild as well.
    [TestKind.standard, TestKind.parallel, TestKind.coverage].forEach(runProfile => {
        let xcTestFailureMessage: string;

        beforeEach(() => {
            // From 5.7 to 5.10 running with the --parallel option dumps the test results out
            // to the console with no newlines, so it isn't possible to distinguish where errors
            // begin and end. Consequently we can't record them, and so we manually mark them
            // as passed or failed with the message from the xunit xml.
            xcTestFailureMessage =
                runProfile === TestKind.parallel &&
                !workspaceContext.toolchain.hasMultiLineParallelTestOutput
                    ? "failed"
                    : "failed - oh no";
        });

        suite(runProfile, () => {
            suite("swift-testing", function () {
                suiteSetup(function () {
                    if (workspaceContext.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                        this.skip();
                    }
                });

                test("Runs passing test", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.topLevelTestPassing()"
                    );

                    assertTestResults(testRun, {
                        passed: ["PackageTests.topLevelTestPassing()"],
                    });
                });

                test("Runs failing test", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.topLevelTestFailing()"
                    );

                    assertTestResults(testRun, {
                        failed: [
                            {
                                test: "PackageTests.topLevelTestFailing()",
                                issues: ["Expectation failed: 1 == 2"],
                            },
                        ],
                    });
                });

                test("Runs Suite", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.MixedSwiftTestingSuite"
                    );
                    assertTestResults(testRun, {
                        passed: ["PackageTests.MixedSwiftTestingSuite/testPassing()"],
                        skipped: ["PackageTests.MixedSwiftTestingSuite/testDisabled()"],
                        failed: [
                            {
                                test: "PackageTests.MixedSwiftTestingSuite/testFailing()",
                                issues: ["Expectation failed: 1 == 2"],
                            },
                        ],
                    });
                });

                test("Runs parameterized test", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.parameterizedTest(_:)"
                    );

                    assertTestResults(testRun, {
                        passed: [
                            "PackageTests.parameterizedTest(_:)/PackageTests.swift:49:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [49])])",
                            "PackageTests.parameterizedTest(_:)/PackageTests.swift:49:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [51])])",
                        ],
                        failed: [
                            {
                                issues: ["Expectation failed: (arg → 2) != 2"],
                                test: "PackageTests.parameterizedTest(_:)/PackageTests.swift:49:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [50])])",
                            },
                        ],
                    });
                });

                test("Runs Suite", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.MixedSwiftTestingSuite"
                    );

                    assertTestResults(testRun, {
                        passed: ["PackageTests.MixedSwiftTestingSuite/testPassing()"],
                        skipped: ["PackageTests.MixedSwiftTestingSuite/testDisabled()"],
                        failed: [
                            {
                                test: "PackageTests.MixedSwiftTestingSuite/testFailing()",
                                issues: ["Expectation failed: 1 == 2"],
                            },
                        ],
                    });
                });

                test("Runs All", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.MixedSwiftTestingSuite",
                        "PackageTests.MixedXCTestSuite"
                    );

                    assertTestResults(testRun, {
                        passed: [
                            "PackageTests.MixedSwiftTestingSuite/testPassing()",
                            "PackageTests.MixedXCTestSuite/testPassing",
                        ],
                        skipped: ["PackageTests.MixedSwiftTestingSuite/testDisabled()"],
                        failed: [
                            {
                                test: "PackageTests.MixedSwiftTestingSuite/testFailing()",
                                issues: ["Expectation failed: 1 == 2"],
                            },
                            {
                                test: "PackageTests.MixedXCTestSuite/testFailing",
                                issues: [xcTestFailureMessage],
                            },
                        ],
                    });
                });
            });

            suite("XCTests", () => {
                test("Runs passing test", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.PassingXCTestSuite"
                    );

                    assertTestResults(testRun, {
                        passed: ["PackageTests.PassingXCTestSuite/testPassing"],
                    });
                });

                test("Runs failing test", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.FailingXCTestSuite/testFailing"
                    );

                    assertTestResults(testRun, {
                        failed: [
                            {
                                test: "PackageTests.FailingXCTestSuite/testFailing",
                                issues: [xcTestFailureMessage],
                            },
                        ],
                    });
                });

                test("Runs Suite", async function () {
                    const testRun = await runTest(
                        testExplorer.controller,
                        runProfile,
                        "PackageTests.MixedXCTestSuite"
                    );

                    assertTestResults(testRun, {
                        passed: ["PackageTests.MixedXCTestSuite/testPassing"],
                        failed: [
                            {
                                test: "PackageTests.MixedXCTestSuite/testFailing",
                                issues: [xcTestFailureMessage],
                            },
                        ],
                    });
                });
            });
        });
    });
});
