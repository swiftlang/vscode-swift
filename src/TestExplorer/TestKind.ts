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

/** Workspace Folder events */
export enum TestKind {
    // run tests serially
    standard = "Run Tests",
    // run tests in parallel
    parallel = "Run Tests (Parallel)",
    // run tests and extract test coverage
    coverage = "Run With Test Coverage",
    // run tests with the debugger
    debug = "Debug Tests",
    // run tests compiled in release mode
    release = "Run Tests (Release Mode)",
    // run tests compiled in release mode with debugger
    debugRelease = "Debug Tests (Release Mode)",
}

export function isDebugging(testKind: TestKind): boolean {
    return testKind === TestKind.debug || testKind === TestKind.debugRelease;
}

export function isRelease(testKind: TestKind): boolean {
    return testKind === TestKind.release || testKind === TestKind.debugRelease;
}
