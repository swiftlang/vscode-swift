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
 * Trust-policy module for SwiftPM plugin auto-elevation.
 *
 * The allowlist is keyed on the resolved upstream URL recorded in
 * `.build/workspace-state.json`, not the workspace-controlled
 * `Package(name:)` string. A workspace can claim any name it wants in its
 * own `Package.swift`, but it cannot forge the URL SwiftPM cloned an
 * external dependency from. That URL is the spoofing vector this module
 * is designed to defeat.
 */
import { PackagePlugin, WorkspaceState } from "../SwiftPackage";

export type PluginPermissions = {
    disableSandbox?: boolean;
    allowWritingToPackageDirectory?: boolean;
    disableTaskQueue?: boolean;
};

type TrustedPluginEntry = {
    urls: readonly string[];
    command: string;
    permissions: PluginPermissions;
};

const TRUSTED_PLUGINS: readonly TrustedPluginEntry[] = [
    {
        urls: [
            "https://github.com/swiftlang/swift-docc-plugin",
            "https://github.com/apple/swift-docc-plugin",
        ],
        command: "generate-documentation",
        permissions: { allowWritingToPackageDirectory: true },
    },
    {
        urls: [
            "https://github.com/swiftlang/swift-docc-plugin",
            "https://github.com/apple/swift-docc-plugin",
        ],
        command: "preview-documentation",
        permissions: { disableSandbox: true, allowWritingToPackageDirectory: true },
    },
    {
        urls: [
            "https://github.com/swiftlang/swift-format",
            "https://github.com/apple/swift-format",
        ],
        command: "format-source-code",
        permissions: { allowWritingToPackageDirectory: true },
    },
    {
        urls: ["https://github.com/nicklockwood/SwiftFormat"],
        command: "swiftformat",
        permissions: { allowWritingToPackageDirectory: true },
    },
    {
        urls: ["https://github.com/swift-server/swift-aws-lambda-runtime"],
        command: "archive",
        permissions: { disableSandbox: true, disableTaskQueue: true },
    },
].map(entry => ({ ...entry, urls: entry.urls.map(normalizeUrl) }));

/** Returns the auto-elevation permissions for `plugin` if its host package
 * resolves from a known canonical upstream URL; otherwise returns `{}`. */
export function getTrustedPluginPermissions(
    plugin: PackagePlugin,
    workspaceState: WorkspaceState | undefined
): PluginPermissions {
    const dep = workspaceState?.object?.dependencies?.find(
        d => isRemoteSourceControl(d.packageRef.kind) && d.packageRef.name === plugin.package
    );
    if (!dep) {
        return {};
    }
    const url = normalizeUrl(dep.packageRef.location);
    const entry = TRUSTED_PLUGINS.find(e => e.command === plugin.command && e.urls.includes(url));
    return { ...entry?.permissions };
}

// Swift 5.5 and earlier emit `"remote"`; 5.6+ emit `"remoteSourceControl"`.
// Compare with `SwiftPackage.dependencyType`, which aliases the same way for
// `"local"` <-> `"fileSystem"`.
function isRemoteSourceControl(kind: string): boolean {
    return kind === "remoteSourceControl" || kind === "remote";
}

function normalizeUrl(url: string): string {
    let result = url.trim().toLowerCase();
    if (result.endsWith("/")) {
        result = result.slice(0, -1);
    }
    if (result.endsWith(".git")) {
        result = result.slice(0, -4);
    }
    return result;
}
