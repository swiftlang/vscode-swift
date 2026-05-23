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
import { PackagePlugin, WorkspaceState } from "@src/SwiftPackage";

export function makePlugin(opts: {
    command: string;
    package: string;
    name?: string;
}): PackagePlugin {
    return {
        command: opts.command,
        name: opts.name ?? opts.command,
        package: opts.package,
    };
}

export type WorkspaceStateDependencyFixture = {
    name: string;
    location: string;
    kind?: string;
    identity?: string;
};

export function makeWorkspaceState(deps: WorkspaceStateDependencyFixture[]): WorkspaceState {
    return {
        version: 6,
        object: {
            dependencies: deps.map(dep => ({
                packageRef: {
                    name: dep.name,
                    location: dep.location,
                    kind: dep.kind ?? "remoteSourceControl",
                    identity: dep.identity ?? dep.name.toLowerCase(),
                },
                state: { name: "checkout" },
                subpath: dep.name,
            })),
        },
    };
}
