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
import * as assert from "assert";
import * as fs from "fs";
import { afterEach, beforeEach } from "mocha";
import * as path from "path";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { runnableTag } from "@src/TestExplorer/TestDiscovery";
import { TestExplorer } from "@src/TestExplorer/TestExplorer";
import { TestKind } from "@src/TestExplorer/TestKind";
import {
    MessageRenderer,
    TestSymbol,
} from "@src/TestExplorer/TestParsers/SwiftTestingOutputParser";
import { TestRunProxy } from "@src/TestExplorer/TestRunProxy";
import { flattenTestItemCollection, reduceTestItemChildren } from "@src/TestExplorer/TestUtils";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { Commands } from "@src/commands";
import { createBuildAllTask } from "@src/tasks/SwiftTaskProvider";
import { lineBreakRegex } from "@src/utilities/tasks";
import { randomString } from "@src/utilities/utilities";
import { Version } from "@src/utilities/version";

import { tag } from "../../tags";
import { executeTaskAndWaitForResult } from "../../utilities/tasks";
import {
    activateExtensionForSuite,
    folderInRootWorkspace,
    updateSettings,
    withLogging,
} from "../utilities/testutilities";
import {
    assertContains,
    assertContainsTrimmed,
    assertTestControllerHierarchy,
    assertTestResults,
    buildStateFromController,
    eventPromise,
    gatherTests,
    runTest as runTestWithLogging,
    waitForTestExplorerReady,
} from "./utilities";

tag("large").suite("Test Explorer Suite", function () {
    let workspaceContext: WorkspaceContext;
    let folderContext: FolderContext;
    let testExplorer: TestExplorer;
    let runTest: (
        testExplorer: TestExplorer,
        runProfile: TestKind,
        ...tests: string[]
    ) => Promise<TestRunProxy>;

    activateExtensionForSuite({
        async setup(ctx) {
            // It can take a very long time for sourcekit-lsp to index tests on Windows,
            // especially w/ Swift 6.0. Wait for up to 25 minutes for the indexing to complete.
            if (process.platform === "win32") {
                this.timeout(25 * 60 * 1000);
            }

            workspaceContext = ctx;
            runTest = runTestWithLogging.bind(null, workspaceContext.logger);
            const logger = withLogging(ctx.logger);
            folderContext = await logger("Locating defaultPackage folder in root workspace", () =>
                folderInRootWorkspace("defaultPackage", workspaceContext)
            );

            if (!folderContext) {
                throw new Error("Unable to find test explorer");
            }

            testExplorer = await logger(
                "Waiting for test explorer to resolve",
                () => folderContext.resolvedTestExplorer
            );

            await logger("Executing build all task", async () =>
                executeTaskAndWaitForResult(await createBuildAllTask(folderContext))
            );

            // Set up the listener before bringing the text explorer in to focus,
            // which starts searching the workspace for tests.
            await logger("Waiting for test explorer to be ready", () =>
                waitForTestExplorerReady(testExplorer, workspaceContext.logger)
            );
        },
        requiresLSP: true,
        requiresDebugger: true,
    });

    suite("Debugging", function () {
        async function runXCTest() {
            const suiteId = "PackageTests.PassingXCTestSuite";
            const testId = `${suiteId}/testPassing`;
            const passingRun = await runTest(testExplorer, TestKind.debug, testId);

            assertTestResults(passingRun, {
                passed: [suiteId, testId],
            });
        }

        async function runSwiftTesting(this: Mocha.Context) {
            if (
                // swift-testing was not able to produce JSON events until 6.0.2 on Windows.
                process.platform === "win32" &&
                workspaceContext.globalToolchainSwiftVersion.isLessThan(new Version(6, 0, 2))
            ) {
                this.skip();
            }

            const testId = "PackageTests.topLevelTestPassing()";
            const testRun = await runTest(testExplorer, TestKind.debug, testId);

            assertTestResults(testRun, {
                passed: [testId],
            });
        }

        suite("lldb-dap", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            beforeEach(async function () {
                // lldb-dap is only present/functional in the toolchain in 6.0.2 and up.
                if (folderContext.swiftVersion.isLessThan(new Version(6, 0, 2))) {
                    this.skip();
                }

                resetSettings = await updateSettings({
                    "swift.debugger.debugAdapter": "lldb-dap",
                });
            });

            afterEach(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            test("Debugs specified XCTest test", async function () {
                // This test is failing consistently on Windows nightly-main (6.3-dev).
                // Skip it until a fix is made.
                //
                // GitHub Issue: https://github.com/swiftlang/vscode-swift/issues/1986
                if (
                    workspaceContext.globalToolchain.swiftVersion.dev &&
                    workspaceContext.globalToolchain.swiftVersion.isGreaterThanOrEqual({
                        major: 6,
                        minor: 3,
                        patch: 0,
                    })
                ) {
                    this.skip();
                }
                await runXCTest.call(this);
            });

            test("Debugs specified swift-testing test", async function () {
                await runSwiftTesting.call(this);
            });
        });

        suite("CodeLLDB", () => {
            let resetSettings: (() => Promise<void>) | undefined;
            beforeEach(async function () {
                // CodeLLDB on windows doesn't print output and so cannot be parsed
                if (
                    process.platform === "win32" ||
                    (process.platform === "linux" &&
                        folderContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 2, 0)))
                ) {
                    this.skip();
                }

                resetSettings = await updateSettings({
                    "swift.debugger.debugAdapter": "CodeLLDB",
                });
            });

            afterEach(async () => {
                if (resetSettings) {
                    await resetSettings();
                    resetSettings = undefined;
                }
            });

            test("Debugs specified XCTest test", async function () {
                // CodeLLDB tests stall out on 5.9 and below.
                if (folderContext.swiftVersion.isLessThan(new Version(5, 10, 0))) {
                    this.skip();
                }
                await runXCTest();
            });

            test("Debugs specified swift-testing test", async function () {
                if (folderContext.swiftVersion.isLessThan(new Version(6, 0, 0))) {
                    this.skip();
                }
                await runSwiftTesting.call(this);
            });
        });
    });

    suite("Standard", () => {
        test("Finds Tests", async function () {
            if (folderContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0))) {
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
                        "testLotsOfOutput()",
                        "testCrashing()",
                        "DuplicateSuffixTests",
                        ["testPassing()", "testPassingSuffix()"],
                        "CrashingXCTests",
                        ["testCrashing()"],
                    ],
                ]);
            } else if (folderContext.swiftVersion.isLessThanOrEqual(new Version(6, 0, 0))) {
                // 5.10 uses `swift test list` which returns test alphabetically, without the round brackets.
                // Does not include swift-testing tests.
                assertTestControllerHierarchy(testExplorer.controller, [
                    "PackageTests",
                    [
                        "CrashingXCTests",
                        ["testCrashing"],
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
                if (
                    folderContext.swiftVersion.isLessThan(new Version(6, 0, 0)) ||
                    // swift-testing was not able to produce JSON events until 6.0.2 on Windows.
                    (process.platform === "win32" &&
                        folderContext.swiftVersion.isLessThan(new Version(6, 0, 2)))
                ) {
                    this.skip();
                }
            });

            test("captures lots of output", async () => {
                const testRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.testLotsOfOutput()"
                );

                assertTestResults(testRun, {
                    passed: ["PackageTests.testLotsOfOutput()"],
                });

                // Right now the swift-testing "test run complete" text is being emitted
                // in the middle of the print, so the last line is actually end end of our
                // huge string. If they fix this in future this `find` ensures the test wont break.
                const needle = "100000";
                const output = testRun.runState.output.flatMap(o =>
                    o.split(lineBreakRegex).filter(o => !!o)
                );
                const lastTenLines = output.slice(-10).join("\n");
                assertContainsTrimmed(
                    output,
                    needle,
                    `Expected all test output to be captured, but it was truncated. Last 10 lines of output were: ${lastTenLines}`
                );
            });

            // Disabled until Attachments are formalized and released.
            test.skip("attachments", async function () {
                // Attachments were introduced in 6.1
                if (folderContext.swiftVersion.isLessThan(new Version(6, 1, 0))) {
                    this.skip();
                }

                const testRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.testAttachment()"
                );

                assertTestResults(testRun, {
                    passed: ["PackageTests.testAttachment()"],
                });

                // Verify the attachment was attached and the contents are correct.
                const attachments = path.join(
                    testExplorer.folderContext.folder.fsPath,
                    "./.build/attachments"
                );

                const attachmentFolders = fs.readdirSync(attachments).map(folder => ({
                    name: folder,
                    time: fs.statSync(path.join(attachments, folder)).mtime.getTime(),
                }));
                assert(attachmentFolders.length > 0, "Attachments directory is empty");

                attachmentFolders.sort((a, b) => b.time - a.time);
                const latestFolder = attachmentFolders[0];
                const latestFolderPath = path.join(attachments, latestFolder.name);
                const latestFolderContents = fs.readdirSync(latestFolderPath);
                assert.deepStrictEqual(latestFolderContents, ["hello.txt"]);

                const attachmentPath = path.join(latestFolderPath, "hello.txt");
                const attachment = fs.readFileSync(attachmentPath, "utf8");
                assert.equal(attachment, "Hello, world!");
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

                const testItem = testRun.testItems.find(
                    ({ id }) => id === "PackageTests.testWithKnownIssue()"
                );
                assert.ok(testItem, "Unable to find test item for testWithKnownIssue");
                assert.ok(
                    testItem.tags.find(tag => tag.id === "skipped"),
                    "skipped tag was not found on test item"
                );
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

            test("crashing", async () => {
                const testRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.testCrashing()"
                );

                assertTestResults(testRun, {
                    failed: [
                        {
                            test: "PackageTests.testCrashing()",
                            issues: ["Test did not complete."],
                        },
                    ],
                });
            });

            test("tests run in debug mode", async function () {
                const testRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.testDebug()"
                );

                assertTestResults(testRun, {
                    passed: ["PackageTests.testDebug()"],
                });
            });

            test("test run in release mode", async function () {
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

                test("runs an swift-testing test multiple times", async function () {
                    const testItems = gatherTests(
                        testExplorer.controller,
                        "PackageTests.MixedXCTestSuite/testPassing"
                    );

                    await workspaceContext.focusFolder(null);
                    await workspaceContext.focusFolder(testExplorer.folderContext);

                    const testRunPromise = eventPromise(testExplorer.onCreateTestRun);

                    await vscode.commands.executeCommand(
                        Commands.RUN_TESTS_MULTIPLE_TIMES,
                        testItems[0],
                        numIterations
                    );

                    const testRun = await testRunPromise;

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

            test("Crashing XCTest", async function () {
                const crashingRun = await runTest(
                    testExplorer,
                    TestKind.standard,
                    "PackageTests.CrashingXCTests/testCrashing"
                );

                assertTestResults(crashingRun, {
                    failed: [
                        {
                            test: "PackageTests.CrashingXCTests/testCrashing",
                            issues: ["Test did not complete."],
                        },
                    ],
                });
            });

            test("Cancellation", async function () {
                const targetProfile = testExplorer.testRunProfiles.find(
                    profile => profile.label === TestKind.standard
                );
                if (!targetProfile) {
                    throw new Error(`Unable to find run profile named ${TestKind.standard}`);
                }
                const testItems = gatherTests(
                    testExplorer.controller,
                    "PackageTests.DuplicateSuffixTests/testPassing"
                );
                const request = new vscode.TestRunRequest(testItems);
                const tokenSource = new vscode.CancellationTokenSource();

                const testRunPromise = eventPromise(testExplorer.onCreateTestRun);

                // Deliberately don't await this so we can cancel it.
                void targetProfile.runHandler(request, tokenSource.token);

                const testRun = await testRunPromise;

                // Wait for the next tick to cancel the test run so that
                // handlers have time to set up.
                await new Promise<void>(resolve => {
                    setImmediate(() => {
                        tokenSource.cancel();
                        resolve();
                    });
                });

                assertContains(testRun.runState.output, "\r\nTest run cancelled.");
            });

            test("Cancellation during build", async function () {
                const targetProfile = testExplorer.testRunProfiles.find(
                    profile => profile.label === TestKind.standard
                );
                if (!targetProfile) {
                    throw new Error(`Unable to find run profile named ${TestKind.standard}`);
                }
                const testItems = gatherTests(
                    testExplorer.controller,
                    "PackageTests.DuplicateSuffixTests/testPassing"
                );
                const request = new vscode.TestRunRequest(testItems);
                const initialTokenSource = new vscode.CancellationTokenSource();

                const testRunPromise = eventPromise(testExplorer.onCreateTestRun);

                // Deliberately don't await this so we can cancel it.
                void targetProfile.runHandler(request, initialTokenSource.token);
                const testRun = await testRunPromise;

                const secondRunTokenSource = new vscode.CancellationTokenSource();
                // Wait for the next tick to cancel the test run so that
                // handlers have time to set up.
                await new Promise<void>(resolve => {
                    setImmediate(async () => {
                        const secondRunOnCreate = eventPromise(testExplorer.onCreateTestRun);
                        // Start the second test run, which will trigger the mockWindow to resolve with
                        // the request to cancel and start a new run. Then wait for the second run to start,
                        // and cancel it as if VS Code requested it.
                        void targetProfile.runHandler(request, secondRunTokenSource.token);
                        await secondRunOnCreate;
                        secondRunTokenSource.cancel();
                        resolve();
                    });
                });

                assertContains(testRun.runState.output, "\r\nTest run cancelled.");
            });

            test("tests run in debug mode", async function () {
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

            test("tests run in release mode", async function () {
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

                test("runs an XCTest multiple times", async function () {
                    const testItems = gatherTests(
                        testExplorer.controller,
                        "PackageTests.PassingXCTestSuite/testPassing"
                    );

                    await workspaceContext.focusFolder(null);
                    await workspaceContext.focusFolder(testExplorer.folderContext);

                    const testRunPromise = eventPromise(testExplorer.onCreateTestRun);

                    await vscode.commands.executeCommand(
                        Commands.RUN_TESTS_MULTIPLE_TIMES,
                        testItems[0],
                        { preserveFocus: true }, // a trailing argument included on Linux
                        numIterations
                    );

                    const testRun = await testRunPromise;

                    assertTestResults(testRun, {
                        passed: [
                            "PackageTests.PassingXCTestSuite",
                            "PackageTests.PassingXCTestSuite/testPassing",
                        ],
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
                    !folderContext.toolchain.hasMultiLineParallelTestOutput
                        ? "failed"
                        : `failed - oh no`;
            });

            suite(runProfile, () => {
                suite(`swift-testing (${runProfile})`, function () {
                    suiteSetup(function () {
                        if (
                            folderContext.swiftVersion.isLessThan(new Version(6, 0, 0)) ||
                            (process.platform === "win32" &&
                                folderContext.swiftVersion.isLessThan(new Version(6, 0, 2)))
                        ) {
                            this.skip();
                        }
                    });

                    test(`Runs passing test (${runProfile})`, async function () {
                        const testRun = await runTest(
                            testExplorer,
                            runProfile,
                            "PackageTests.topLevelTestPassing()"
                        );

                        // Use assertContainsTrimmed to ignore the line ending differences
                        // across platforms (windows vs linux/darwin)
                        assertContainsTrimmed(
                            testRun.runState.output,
                            "A print statement in a test."
                        );
                        assertTestResults(testRun, {
                            passed: ["PackageTests.topLevelTestPassing()"],
                        });
                    });

                    test(`swift-testing Runs failing test (${runProfile})`, async function () {
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

                    test(`swift-testing Runs Suite (${runProfile})`, async function () {
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

                    test(`swift-testing Runs parameterized test (${runProfile})`, async function () {
                        const testId = "PackageTests.parameterizedTest(_:)";
                        const testRun = await runTest(testExplorer, runProfile, testId);

                        let passed: string[];
                        let failedId: string;
                        if (folderContext.swiftVersion.isGreaterThanOrEqual(new Version(6, 2, 0))) {
                            passed = [
                                `${testId}/PackageTests.swift:59:2/Parameterized test case ID: argumentIDs: [Testing.Test.Case.Argument.ID(bytes: [49])], discriminator: 0, isStable: true`,
                                `${testId}/PackageTests.swift:59:2/Parameterized test case ID: argumentIDs: [Testing.Test.Case.Argument.ID(bytes: [51])], discriminator: 0, isStable: true`,
                            ];
                            failedId = `${testId}/PackageTests.swift:59:2/Parameterized test case ID: argumentIDs: [Testing.Test.Case.Argument.ID(bytes: [50])], discriminator: 0, isStable: true`;
                        } else {
                            passed = [
                                `${testId}/PackageTests.swift:59:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [49])])`,
                                `${testId}/PackageTests.swift:59:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [51])])`,
                            ];
                            failedId = `${testId}/PackageTests.swift:59:2/argumentIDs: Optional([Testing.Test.Case.Argument.ID(bytes: [50])])`;
                        }

                        assertTestResults(testRun, {
                            passed,
                            failed: [
                                {
                                    issues: [
                                        `2 \u{203A} ${MessageRenderer.render({
                                            symbol: TestSymbol.fail,
                                            text: "Expectation failed: (arg → 2) != 2",
                                        })}`,
                                    ],
                                    test: failedId,
                                },
                                {
                                    issues: [],
                                    test: testId,
                                },
                            ],
                        });

                        // Verifiy that the children of the parameterized test are not runnable
                        const parameterizedTestItem = flattenTestItemCollection(
                            testExplorer.controller.items
                        ).find(item => item.id === testId);

                        assert.ok(
                            parameterizedTestItem,
                            `Unable to find ${testId} in test explorer children`
                        );

                        const unrunnableChildren = reduceTestItemChildren(
                            parameterizedTestItem?.children ?? [],
                            (acc, item) => {
                                return [
                                    ...acc,
                                    item.tags.find(tag => tag.id === runnableTag.id) === undefined,
                                ];
                            },
                            [] as boolean[]
                        );

                        assert.deepEqual(unrunnableChildren, [true, true, true]);
                    });

                    test(`swift-testing Runs Suite (${runProfile})`, async function () {
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

                    test(`swift-testing Runs All (${runProfile})`, async function () {
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
                    test(`XCTest Runs passing test (${runProfile})`, async function () {
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

                    test(`XCTest Runs failing test (${runProfile})`, async function () {
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

                    test(`XCTest Runs Suite (${runProfile})`, async function () {
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

    suite("Modifying", function () {
        let sourceFile: string;
        let originalSource: string;

        suiteSetup(function () {
            if (
                (process.platform === "win32" &&
                    workspaceContext.globalToolchainSwiftVersion.isLessThan(
                        new Version(6, 1, 0)
                    )) ||
                workspaceContext.globalToolchainSwiftVersion.isLessThan(new Version(6, 0, 2))
            ) {
                this.skip();
            }
        });

        beforeEach(() => {
            sourceFile = path.join(
                folderContext.folder.fsPath,
                "Tests",
                "PackageTests",
                "PackageTests.swift"
            );
            originalSource = fs.readFileSync(sourceFile, "utf8");
        });

        async function appendSource(newContent: string) {
            const document = await vscode.workspace.openTextDocument(sourceFile);
            await vscode.window.showTextDocument(document);
            const edit = new vscode.WorkspaceEdit();
            const lastLine = document.lineAt(document.lineCount - 1);
            edit.insert(document.uri, lastLine.range.end, newContent);
            await vscode.workspace.applyEdit(edit);
            return document;
        }

        async function setSource(content: string) {
            const document = await vscode.workspace.openTextDocument(sourceFile);
            await vscode.window.showTextDocument(document);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
                document.uri,
                document.validateRange(new vscode.Range(0, 0, 10000000, 0)),
                content
            );
            await vscode.workspace.applyEdit(edit);
            return document;
        }

        type TestHierarchy = string | TestHierarchy[];

        // Because we're at the whim of how often VS Code/the LSP provide document symbols
        // we can't assume that changes to test items will be reflected in the next onTestItemsDidChange
        // so poll until the condition is met.
        async function validate(validator: (testItems: TestHierarchy) => boolean) {
            let testItems: TestHierarchy = [];
            const startTime = Date.now();
            while (Date.now() - startTime < 5000) {
                testItems = buildStateFromController(testExplorer.controller.items);
                if (validator(testItems)) {
                    return;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            assert.fail("Expected test items to be updated, but they were not: " + testItems);
        }

        test("Test explorer updates when a test is added and removed", async () => {
            const testName = `newTest${randomString()}()`;
            const newTest = `\n@Test func ${testName} {\n    #expect(1 == 1)\n}\n`;

            await Promise.all([
                eventPromise(testExplorer.onTestItemsDidChange),
                appendSource(newTest),
            ]);

            await validate(testItems => testItems[1].includes(testName));

            await Promise.all([
                eventPromise(testExplorer.onTestItemsDidChange),
                setSource(originalSource),
            ]);

            await validate(testItems => !testItems[1].includes(testName));
        });

        test("Test explorer updates when a suite is added and removed", async () => {
            const suiteName = `newSuite${randomString()}`;
            const newSuite = `\n@Suite\nstruct ${suiteName} {\n    @Test\n    func testPassing() throws {\n        #expect(1 == 1)\n    }\n}\n`;
            await Promise.all([
                eventPromise(testExplorer.onTestItemsDidChange),
                appendSource(newSuite),
            ]);
            await validate(testItems => testItems[1].includes(suiteName));

            await Promise.all([
                eventPromise(testExplorer.onTestItemsDidChange),
                setSource(originalSource),
            ]);
            await validate(testItems => !testItems[1].includes(suiteName));
        });

        afterEach(async () => {
            const document = await setSource(originalSource);
            await document.save();
        });
    });
});
