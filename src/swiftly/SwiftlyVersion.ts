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
import { Version } from "../utilities/version";
import { SwiftlyError } from "./SwiftlyError";

export class SwiftlyVersion extends Version {
    static fromString(s: string): SwiftlyVersion {
        const version = Version.fromString(s);
        if (!version) {
            throw SwiftlyError.unknown({
                message: `Unable to parse Swiftly version string: "${s}"`,
            });
        }
        return new SwiftlyVersion(version);
    }

    constructor(version: Version);
    constructor(major: number, minor: number, patch: number, dev?: boolean);
    constructor(
        versionOrMajor: Version | number,
        minor: number = 0,
        patch: number = 0,
        dev: boolean = false
    ) {
        if (typeof versionOrMajor === "number") {
            super(versionOrMajor, minor, patch, dev);
        } else {
            const version = versionOrMajor;
            super(version.major, version.minor, version.patch, version.dev);
        }
    }

    /** Whether or not Swiftly supports the `--format=json` command line option. */
    get supportsJSONOutput(): boolean {
        return this.isGreaterThanOrEqual({ major: 1, minor: 1, patch: 0 });
    }
}
