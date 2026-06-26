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
import { expect } from "chai";

import { PluginPermissions, getTrustedPluginPermissions } from "@src/tasks/TrustedPlugins";

import { makePlugin, makeWorkspaceState } from "./fixtures/pluginFixtures";

const SWIFTLANG_DOCC_URL = "https://github.com/swiftlang/swift-docc-plugin";
const APPLE_DOCC_URL = "https://github.com/apple/swift-docc-plugin";
const SWIFTLANG_FORMAT_URL = "https://github.com/swiftlang/swift-format";
const APPLE_FORMAT_URL = "https://github.com/apple/swift-format";
const NICKLOCKWOOD_SWIFTFORMAT_URL = "https://github.com/nicklockwood/SwiftFormat";
const SWIFT_AWS_LAMBDA_URL = "https://github.com/swift-server/swift-aws-lambda-runtime";

suite("TrustedPlugins Unit Test Suite", () => {
    suite("returns no permissions when there is no proof of identity", () => {
        // Each row models a distinct way an attacker, or a benign edge case,
        // could fail to produce a verifiable upstream URL for a plugin.
        type RefusalCase = {
            description: string;
            workspaceState: ReturnType<typeof makeWorkspaceState> | undefined;
            command?: string;
        };
        const refusalCases: RefusalCase[] = [
            {
                description: "workspace state is undefined (fresh checkout, before resolve)",
                workspaceState: undefined,
            },
            {
                description: "plugin lives in the root workspace package",
                workspaceState: makeWorkspaceState([]),
            },
            {
                description: "plugin host package is a local path dependency",
                workspaceState: makeWorkspaceState([
                    {
                        name: "SwiftDocCPlugin",
                        location: "/Users/attacker/local-swift-docc-plugin",
                        kind: "fileSystem",
                    },
                ]),
            },
            {
                description: "plugin host package was added via a swift package registry",
                workspaceState: makeWorkspaceState([
                    {
                        name: "SwiftDocCPlugin",
                        location: "swiftlang.swift-docc-plugin",
                        kind: "registry",
                    },
                ]),
            },
            {
                description: "URL is a fork at a non-canonical host",
                workspaceState: makeWorkspaceState([
                    {
                        name: "SwiftDocCPlugin",
                        location: "https://github.com/attacker/swift-docc-plugin",
                    },
                ]),
            },
            {
                description: "plugin command is not in the allowlist for the matched URL",
                workspaceState: makeWorkspaceState([
                    { name: "SwiftDocCPlugin", location: SWIFTLANG_DOCC_URL },
                ]),
                command: "evil-command",
            },
            {
                description: "plugin's package name does not match any workspace-state entry",
                workspaceState: makeWorkspaceState([
                    { name: "swift-docc-plugin", location: SWIFTLANG_DOCC_URL },
                ]),
            },
        ];

        refusalCases.forEach(({ description, workspaceState, command }) => {
            test(description, () => {
                const result = getTrustedPluginPermissions(
                    makePlugin({
                        command: command ?? "preview-documentation",
                        package: "SwiftDocCPlugin",
                    }),
                    workspaceState
                );
                expect(result).to.deep.equal({});
            });
        });
    });

    suite("grants the documented permissions for canonical trusted plugins", () => {
        const trustedCases: Array<{
            description: string;
            packageName: string;
            url: string;
            command: string;
            expected: PluginPermissions;
        }> = [
            {
                description: "SwiftDocCPlugin / preview-documentation (swiftlang)",
                packageName: "SwiftDocCPlugin",
                url: SWIFTLANG_DOCC_URL,
                command: "preview-documentation",
                expected: { disableSandbox: true, allowWritingToPackageDirectory: true },
            },
            {
                description: "SwiftDocCPlugin / preview-documentation (legacy apple/ alias)",
                packageName: "SwiftDocCPlugin",
                url: APPLE_DOCC_URL,
                command: "preview-documentation",
                expected: { disableSandbox: true, allowWritingToPackageDirectory: true },
            },
            {
                description: "SwiftDocCPlugin / generate-documentation",
                packageName: "SwiftDocCPlugin",
                url: SWIFTLANG_DOCC_URL,
                command: "generate-documentation",
                expected: { allowWritingToPackageDirectory: true },
            },
            {
                description: "swift-format / format-source-code (swiftlang)",
                packageName: "swift-format",
                url: SWIFTLANG_FORMAT_URL,
                command: "format-source-code",
                expected: { allowWritingToPackageDirectory: true },
            },
            {
                description: "swift-format / format-source-code (legacy apple/ alias)",
                packageName: "swift-format",
                url: APPLE_FORMAT_URL,
                command: "format-source-code",
                expected: { allowWritingToPackageDirectory: true },
            },
            {
                description: "nicklockwood SwiftFormat / swiftformat",
                packageName: "SwiftFormat",
                url: NICKLOCKWOOD_SWIFTFORMAT_URL,
                command: "swiftformat",
                expected: { allowWritingToPackageDirectory: true },
            },
            {
                description: "swift-aws-lambda-runtime / archive",
                packageName: "swift-aws-lambda-runtime",
                url: SWIFT_AWS_LAMBDA_URL,
                command: "archive",
                expected: { disableSandbox: true, disableTaskQueue: true },
            },
        ];

        trustedCases.forEach(({ description, packageName, url, command, expected }) => {
            test(description, () => {
                const result = getTrustedPluginPermissions(
                    makePlugin({ command, package: packageName }),
                    makeWorkspaceState([{ name: packageName, location: url }])
                );
                expect(result).to.deep.equal(expected);
            });
        });
    });

    suite("URL normalization tolerates SwiftPM-canonical variants", () => {
        const normalizationCases: Array<{
            description: string;
            location: string;
            matches: boolean;
        }> = [
            {
                description: "trailing .git suffix",
                location: `${SWIFTLANG_DOCC_URL}.git`,
                matches: true,
            },
            { description: "trailing slash", location: `${SWIFTLANG_DOCC_URL}/`, matches: true },
            {
                description: "trailing `.git/` (both suffixes together)",
                location: `${SWIFTLANG_DOCC_URL}.git/`,
                matches: true,
            },
            {
                description: "case differences on host and path",
                location: "https://GitHub.com/SwiftLang/Swift-Docc-Plugin",
                matches: true,
            },
            {
                description: "URL containing canonical URL as a substring is NOT a match",
                location: `https://github.com/attacker/proxy?u=${SWIFTLANG_DOCC_URL}`,
                matches: false,
            },
        ];

        normalizationCases.forEach(({ description, location, matches }) => {
            test(description, () => {
                const result = getTrustedPluginPermissions(
                    makePlugin({ command: "preview-documentation", package: "SwiftDocCPlugin" }),
                    makeWorkspaceState([{ name: "SwiftDocCPlugin", location }])
                );
                if (matches) {
                    expect(result).to.have.property("disableSandbox", true);
                } else {
                    expect(result).to.deep.equal({});
                }
            });
        });
    });

    test("returned permissions are a fresh copy (mutating one call does not affect another)", () => {
        const ws = makeWorkspaceState([{ name: "SwiftDocCPlugin", location: SWIFTLANG_DOCC_URL }]);
        const a = getTrustedPluginPermissions(
            makePlugin({ command: "preview-documentation", package: "SwiftDocCPlugin" }),
            ws
        );
        a.disableSandbox = false;
        const b = getTrustedPluginPermissions(
            makePlugin({ command: "preview-documentation", package: "SwiftDocCPlugin" }),
            ws
        );
        expect(b.disableSandbox).to.equal(true);
    });

    test('accepts the legacy SwiftPM `kind: "remote"` alias for `"remoteSourceControl"`', () => {
        // Pre-Swift-5.6 toolchains write `"kind": "remote"` for the same
        // dependency type later renamed `"remoteSourceControl"`. The codebase
        // already aliases `"local"` <-> `"fileSystem"` for this exact reason
        // (SwiftPackage.ts:474-486). This test pins the same handling for
        // the remote source-control case.
        const result = getTrustedPluginPermissions(
            makePlugin({ command: "preview-documentation", package: "SwiftDocCPlugin" }),
            makeWorkspaceState([
                { name: "SwiftDocCPlugin", location: SWIFTLANG_DOCC_URL, kind: "remote" },
            ])
        );
        expect(result).to.deep.equal({
            disableSandbox: true,
            allowWritingToPackageDirectory: true,
        });
    });

    suite("does not throw on malformed workspace-state.json shapes", () => {
        // `loadWorkspaceState` does not validate the shape of the parsed JSON.
        // Partial writes, future schema changes, or a hand-crafted file can
        // produce values that don't satisfy the WorkspaceState type. The
        // function MUST fail safe (return `{}`) rather than crash task
        // creation.
        const malformedCases: Array<{ description: string; ws: unknown }> = [
            { description: "object property missing", ws: { version: 6 } },
            { description: "dependencies property missing", ws: { version: 6, object: {} } },
            {
                description: "dependencies is not an array",
                ws: { version: 6, object: { dependencies: null } },
            },
        ];

        malformedCases.forEach(({ description, ws }) => {
            test(description, () => {
                const result = getTrustedPluginPermissions(
                    makePlugin({ command: "preview-documentation", package: "SwiftDocCPlugin" }),
                    ws as ReturnType<typeof makeWorkspaceState>
                );
                expect(result).to.deep.equal({});
            });
        });
    });
});
