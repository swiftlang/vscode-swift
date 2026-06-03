//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

/**
 * VS Code hardening injects `safe.bareRepository=explicit` into the environment
 * using git's indexed `GIT_CONFIG_*` variables. SwiftPM does not understand this
 * setting and fails to clone dependencies.
 *
 * Produce an environment override that resets each matching `GIT_CONFIG_VALUE_<n>`
 * back to `all`, scoped to the swift processes we spawn. Only entries currently set
 * to `explicit` are touched; all other git configuration is left untouched.
 *
 * This can be removed when the following issue is resolved:
 * https://github.com/swiftlang/swift-package-manager/issues/8068
 *
 * @param env environment to inspect, defaults to the current process environment
 * @returns the `GIT_CONFIG_VALUE_<n>` overrides to merge into a child environment
 */
export function safeBareRepositoryEnvironmentOverride(env: NodeJS.ProcessEnv = process.env): {
    [key: string]: string;
} {
    const count = parseInt(env.GIT_CONFIG_COUNT ?? "", 10);
    if (!Number.isFinite(count) || count <= 0) {
        return {};
    }
    const indices = Array.from({ length: count }, (_, n) => n);
    return indices.reduce<{ [key: string]: string }>((overrides, n) => {
        const isExplicitBareRepository =
            env[`GIT_CONFIG_KEY_${n}`] === "safe.bareRepository" &&
            env[`GIT_CONFIG_VALUE_${n}`] === "explicit";
        return isExplicitBareRepository
            ? { ...overrides, [`GIT_CONFIG_VALUE_${n}`]: "all" }
            : overrides;
    }, {});
}
