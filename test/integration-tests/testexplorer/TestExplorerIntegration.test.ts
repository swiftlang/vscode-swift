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
import { beforeEach, afterEach } from "mocha";
import { testAssetUri } from "../../fixtures";
import { TestExplorer } from "../../../src/TestExplorer/TestExplorer";
import {
    assertContains,
    assertTestControllerHierarchy,
    assertTestResults,
    eventPromise,
    gatherTests,
    runTest,
    SettingsMap,
    testExplorerFor,
    updateSettings,
    waitForTestExplorerReady,
} from "./utilities";
import { globalWorkspaceContextPromise } from "../extension.test";
import { WorkspaceContext } from "../../../src/WorkspaceContext";
import { Version } from "../../../src/utilities/version";
import { TestKind } from "../../../src/TestExplorer/TestKind";
import {
    MessageRenderer,
    TestSymbol,
} from "../../../src/TestExplorer/TestParsers/SwiftTestingOutputParser";
import { mockGlobalObject } from "../../MockUtils";

suite("Test Explorer Suite", function () {
    const MAX_TEST_RUN_TIME_MINUTES = 5;

    this.timeout(1000 * 60 * MAX_TEST_RUN_TIME_MINUTES);

    let workspaceContext: WorkspaceContext;
    let testExplorer: TestExplorer;

    suite("Debugging", function () {
        let settingsTeardown: () => void;

        async function setup(settings: SettingsMap) {
            settingsTeardown = await updateSettings(settings);

            const testProject = testAssetUri("defaultPackage");

            workspaceContext = await globalWorkspaceContextPromise;
            testExplorer = testExplorerFor(workspaceContext, testProject);

            // Set up the listener before bringing the text explorer in to focus,
            // which starts searching the workspace for tests.
            await waitForTestExplorerReady(testExplorer);
        }

        async function runXCTest() {
            const suiteId = "PackageTests.PassingXCTestSuite";
            const testId = `${suiteId}/testPassing`;
            const passingRun = await runTest(testExplorer, TestKind.debug, testId);

            assertTestResults(passingRun, {
                passed: [suiteId, testId],
            });
        }

        async function runSwiftTesting() {
            const testId = "PackageTests.topLevelTestPassing()";
            const testRun = await runTest(testExplorer, TestKind.debug, testId);

            assertTestResults(testRun, {
                passed: [testId],
            });
        }

        suite("lldb-dap", () => {
            beforeEach(async function () {
                await setup({
                    "swift.debugger.useDebugAdapterFromToolchain": true,
                });

                // lldb-dap is only present in the toolchain in 6.0 and up.
                if (workspaceContext.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                    this.skip();
                }
            });

            test("Debugs specified XCTest test", runXCTest);
            test("Debugs specified swift-testing test", runSwiftTesting);
        });

        suite("CodeLLDB", () => {
            beforeEach(async function () {
                await setup({
                    "swift.debugger.useDebugAdapterFromToolchain": false,
                    ...(process.env["CI"] === "1" ? { "lldb.library": "/usr/lib/liblldb.so" } : {}),
                });
            });

            test("Debugs specified XCTest test", async function () {
                // CodeLLDB tests stall out on 5.9 and below.
                if (workspaceContext.swiftVersion.isLessThan(new Version(5, 10, 0))) {
                    this.skip();
                }
                await runXCTest();
            });
            test("Debugs specified swift-testing test", async function () {
                if (workspaceContext.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                    this.skip();
                }
                await runSwiftTesting();
            });
        });

        afterEach(() => settingsTeardown());
    });

    suite("", () => {
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
            await waitForTestExplorerReady(testExplorer);
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
                        "DuplicateSuffixTests",
                        ["testPassing()", "testPassingSuffix()"],
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
                        "DuplicateSuffixTests",
                        ["testPassing", "testPassingSuffix"],
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
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.testWithKnownIssue()"
                );

                assertTestResults(testRun, {
                    skipped: ["PackageTests.testWithKnownIssue()"],
                });
            });

            test("testWithKnownIssueAndUnknownIssue", async () => {
                const testRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.testWithKnownIssueAndUnknownIssue()"
                );

                assertTestResults(testRun, {
                    failed: [
                        {
                            test: "PackageTests.testWithKnownIssueAndUnknownIssue()",
                            issues: [
                                MessageRenderer.render({
                                    symbol: TestSymbol.fail,
                                    text: "Expectation failed: 2 == 3",
                                }),
                            ],
                        },
                    ],
                });
            });

            test("tests run in debug mode @slow", async function () {
                const testRun = await runTest(
                    testExplorer,
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
                    testExplorer,
                    TestKind.release,
                    "PackageTests.testRelease()"
                );
                assertTestResults(passingRun, {
                    passed: ["PackageTests.testRelease()"],
                });

                const failingRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.testRelease()"
                );

                const issueLine1 = MessageRenderer.render({
                    symbol: TestSymbol.fail,
                    text: "Issue recorded",
                });
                const issueLine2 = MessageRenderer.render({
                    symbol: TestSymbol.details,
                    text: "Test was run in debug mode.",
                });
                const issueText = `${issueLine1}\n${issueLine2}`;
                assertTestResults(failingRun, {
                    failed: [
                        {
                            test: "PackageTests.testRelease()",
                            issues: [issueText],
                        },
                    ],
                });
            });

            suite("Runs multiple", function () {
                const numIterations = 5;
                const windowMock = mockGlobalObject(vscode, "window");

                test("@slow runs an swift-testing test multiple times", async function () {
                    const testItems = await gatherTests(
                        testExplorer.controller,
                        "PackageTests.MixedXCTestSuite/testPassing"
                    );

                    await testExplorer.folderContext.workspaceContext.focusFolder(
                        testExplorer.folderContext
                    );

                    // Stub the showInputBox method to return the input text
                    windowMock.showInputBox.resolves(`${numIterations}`);

                    vscode.commands.executeCommand("swift.runTestsMultipleTimes", testItems[0]);

                    const testRun = await eventPromise(testExplorer.onCreateTestRun);

                    await eventPromise(testRun.onTestRunComplete);

                    assertTestResults(testRun, {
                        passed: [
                            "PackageTests.MixedXCTestSuite",
                            "PackageTests.MixedXCTestSuite/testPassing",
                        ],
                    });
                });
            });
        });

        suite("XCTest", () => {
            test("Only runs specified test", async function () {
                const passingRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.DuplicateSuffixTests/testPassing"
                );

                assertTestResults(passingRun, {
                    passed: [
                        "PackageTests.DuplicateSuffixTests",
                        "PackageTests.DuplicateSuffixTests/testPassing",
                    ],
                });
            });

            test("tests run in debug mode @slow", async function () {
                const testRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.DebugReleaseTestSuite/testDebug"
                );

                assertTestResults(testRun, {
                    passed: [
                        "PackageTests.DebugReleaseTestSuite",
                        "PackageTests.DebugReleaseTestSuite/testDebug",
                    ],
                });
            });

            test("tests run in release mode @slow", async function () {
                // Building in release takes a long time.
                this.timeout(1000 * 60 * MAX_TEST_RUN_TIME_MINUTES * 2);

                const passingRun = await runTest(
                    testExplorer,
                    TestKind.release,
                    "PackageTests.DebugReleaseTestSuite/testRelease"
                );

                assertTestResults(passingRun, {
                    passed: [
                        "PackageTests.DebugReleaseTestSuite",
                        "PackageTests.DebugReleaseTestSuite/testRelease",
                    ],
                });
            });

            suite("Runs multiple", function () {
                const numIterations = 5;
                const windowMock = mockGlobalObject(vscode, "window");

                test("@slow runs an XCTest multiple times", async function () {
                    const testItems = await gatherTests(
                        testExplorer.controller,
                        "PackageTests.topLevelTestPassing()"
                    );

                    await testExplorer.folderContext.workspaceContext.focusFolder(
                        testExplorer.folderContext
                    );

                    // Stub the showInputBox method to return the input text
                    windowMock.showInputBox.resolves(`${numIterations}`);

                    vscode.commands.executeCommand("swift.runTestsMultipleTimes", testItems[0]);

                    const testRun = await eventPromise(testExplorer.onCreateTestRun);

                    await eventPromise(testRun.onTestRunComplete);

                    assertTestResults(testRun, {
                        passed: ["PackageTests.topLevelTestPassing()"],
                    });
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
                suite(`swift-testing (${runProfile})`, function () {
                    suiteSetup(function () {
                        if (workspaceContext.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                            this.skip();
                        }
                    });

                    test(`Runs passing test (${runProfile})`, async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.topLevelTestPassing()"
                        );

                        assertContains(
                            testRun.runState.output,
                            "A print statement in a test.\r\r\n"
                        );
                        assertTestResults(testRun, {
                            passed: ["PackageTests.topLevelTestPassing()"],
                        });
                    });

                    test(`Runs failing test (${runProfile})`, async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.topLevelTestFailing()"
                        );

                        assertTestResults(testRun, {
                            failed: [
                                {
                                    test: "PackageTests.topLevelTestFailing()",
                                    issues: [
                                        MessageRenderer.render({
                                            symbol: TestSymbol.fail,
                                            text: "Expectation failed: 1 == 2",
                                        }),
                                    ],
                                },
                            ],
                        });
                    });

                    test(`Runs Suite (${runProfile})`, async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.MixedSwiftTestingSuite"
                        );

                        assertTestResults(testRun, {
                            passed: ["PackageTests.MixedSwiftTestingSuite/testPassing()"],
                            skipped: ["PackageTests.MixedSwiftTestingSuite/testDisabled()"],
                            failed: [
                                {
                                    test: "PackageTests.MixedSwiftTestingSuite/testFailing()",
                                    issues: [
                                        `testFailing() \u{203A} ${MessageRenderer.render({ symbol: TestSymbol.fail, text: "Expectation failed: 1 == 2" })}`,
                                    ],
                                },
                                {
                                    issues: [],
                                    test: "PackageTests.MixedSwiftTestingSuite",
                                },
                            ],
                        });
                    });

                    test(`Runs parameterized test (${runProfile})`, async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.parameterizedTest(_:)"
                        );

                        assertTestResults(testRun, {
                            passed: [
                                "PackageTests.parameterizedTest(_:)/PackageTests.swift:59:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [49])])",
                                "PackageTests.parameterizedTest(_:)/PackageTests.swift:59:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [51])])",
                            ],
                            failed: [
                                {
                                    issues: [
                                        `2 \u{203A} ${MessageRenderer.render({
                                            symbol: TestSymbol.fail,
                                            text: "Expectation failed: (arg → 2) != 2",
                                        })}`,
                                    ],
                                    test: "PackageTests.parameterizedTest(_:)/PackageTests.swift:59:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [50])])",
                                },
                                {
                                    issues: [],
                                    test: "PackageTests.parameterizedTest(_:)",
                                },
                            ],
                        });
                    });

                    test(`Runs Suite (${runProfile})`, async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.MixedSwiftTestingSuite"
                        );

                        assertTestResults(testRun, {
                            passed: ["PackageTests.MixedSwiftTestingSuite/testPassing()"],
                            skipped: ["PackageTests.MixedSwiftTestingSuite/testDisabled()"],
                            failed: [
                                {
                                    test: "PackageTests.MixedSwiftTestingSuite/testFailing()",
                                    issues: [
                                        `testFailing() \u{203A} ${MessageRenderer.render({ symbol: TestSymbol.fail, text: "Expectation failed: 1 == 2" })}`,
                                    ],
                                },
                                {
                                    issues: [],
                                    test: "PackageTests.MixedSwiftTestingSuite",
                                },
                            ],
                        });
                    });

                    test(`Runs All (${runProfile})`, async function () {
                        const testRun = await runTest(
                            testExplorer,
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
                                    issues: [
                                        `testFailing() \u{203A} ${MessageRenderer.render({ symbol: TestSymbol.fail, text: "Expectation failed: 1 == 2" })}`,
                                    ],
                                },
                                {
                                    issues: [],
                                    test: "PackageTests.MixedSwiftTestingSuite",
                                },
                                {
                                    test: "PackageTests.MixedXCTestSuite/testFailing",
                                    issues: [xcTestFailureMessage],
                                },
                                {
                                    issues: [],
                                    test: "PackageTests.MixedXCTestSuite",
                                },
                            ],
                        });
                    });
                });

                suite(`XCTests (${runProfile})`, () => {
                    test("Runs passing test", async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.PassingXCTestSuite"
                        );

                        assertTestResults(testRun, {
                            passed: [
                                "PackageTests.PassingXCTestSuite",
                                "PackageTests.PassingXCTestSuite/testPassing",
                            ],
                        });
                    });

                    test("Runs failing test", async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.FailingXCTestSuite/testFailing"
                        );

                        assertTestResults(testRun, {
                            failed: [
                                {
                                    test: "PackageTests.FailingXCTestSuite/testFailing",
                                    issues: [xcTestFailureMessage],
                                },
                                {
                                    issues: [],
                                    test: "PackageTests.FailingXCTestSuite",
                                },
                            ],
                        });
                    });

                    test("Runs Suite", async function () {
                        const testRun = await runTest(
                            testExplorer,
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
                                {
                                    issues: [],
                                    test: "PackageTests.MixedXCTestSuite",
                                },
                            ],
                        });
                    });
                });
            });
        });
    });
});
