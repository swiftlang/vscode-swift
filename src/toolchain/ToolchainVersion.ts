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

/**
 * This code is a port of the toolchain version parsing in Swiftly.
 * Until Swiftly can report the location of the toolchains under its management
 * use `ToolchainVersion.parse(versionString)` to reconstruct the directory name of the toolchain on disk.
 * https://github.com/swiftlang/swiftly/blob/bd6884316817e400a0ec512599f046fa437e9760/Sources/SwiftlyCore/ToolchainVersion.swift#
 */
//
// Enum representing a fully resolved toolchain version (e.g. 5.6.7 or 5.7-snapshot-2022-07-05).
export class ToolchainVersion {
    private type: "stable" | "snapshot";
    private value: StableRelease | Snapshot;

    constructor(
        value:
            | {
                  type: "stable";
                  major: number;
                  minor: number;
                  patch: number;
              }
            | {
                  type: "snapshot";
                  branch: Branch;
                  date: string;
              }
    ) {
        if (value.type === "stable") {
            this.type = "stable";
            this.value = new StableRelease(value.major, value.minor, value.patch);
        } else {
            this.type = "snapshot";
            this.value = new Snapshot(value.branch, value.date);
        }
    }

    private static stableRegex = /^(?:Swift )?(\d+)\.(\d+)\.(\d+)$/;
    private static mainSnapshotRegex = /^main-snapshot-(\d{4}-\d{2}-\d{2})$/;
    private static releaseSnapshotRegex = /^(\d+)\.(\d+)-snapshot-(\d{4}-\d{2}-\d{2})$/;

    /**
     * Parse a toolchain version from the provided string
     **/
    static parse(string: string): ToolchainVersion {
        let match: RegExpMatchArray | null;

        // Try to match as stable release
        match = string.match(this.stableRegex);
        if (match) {
            const major = parseInt(match[1], 10);
            const minor = parseInt(match[2], 10);
            const patch = parseInt(match[3], 10);

            if (isNaN(major) || isNaN(minor) || isNaN(patch)) {
                throw new Error(`invalid stable version: ${string}`);
            }

            return new ToolchainVersion({
                type: "stable",
                major,
                minor,
                patch,
            });
        }

        // Try to match as main snapshot
        match = string.match(this.mainSnapshotRegex);
        if (match) {
            return new ToolchainVersion({
                type: "snapshot",
                branch: Branch.main(),
                date: match[1],
            });
        }

        // Try to match as release snapshot
        match = string.match(this.releaseSnapshotRegex);
        if (match) {
            const major = parseInt(match[1], 10);
            const minor = parseInt(match[2], 10);

            if (isNaN(major) || isNaN(minor)) {
                throw new Error(`invalid release snapshot version: ${string}`);
            }

            return new ToolchainVersion({
                type: "snapshot",
                branch: Branch.release(major, minor),
                date: match[3],
            });
        }

        throw new Error(`invalid toolchain version: "${string}"`);
    }

    get name(): string {
        if (this.type === "stable") {
            const release = this.value as StableRelease;
            return `${release.major}.${release.minor}.${release.patch}`;
        } else {
            const snapshot = this.value as Snapshot;
            if (snapshot.branch.type === "main") {
                return `main-snapshot-${snapshot.date}`;
            } else {
                return `${snapshot.branch.major}.${snapshot.branch.minor}-snapshot-${snapshot.date}`;
            }
        }
    }

    get identifier(): string {
        if (this.type === "stable") {
            const release = this.value as StableRelease;
            if (release.patch === 0) {
                if (release.minor === 0) {
                    return `swift-${release.major}-RELEASE`;
                }
                return `swift-${release.major}.${release.minor}-RELEASE`;
            }
            return `swift-${release.major}.${release.minor}.${release.patch}-RELEASE`;
        } else {
            const snapshot = this.value as Snapshot;
            if (snapshot.branch.type === "main") {
                return `swift-DEVELOPMENT-SNAPSHOT-${snapshot.date}-a`;
            } else {
                return `swift-${snapshot.branch.major}.${snapshot.branch.minor}-DEVELOPMENT-SNAPSHOT-${snapshot.date}-a`;
            }
        }
    }

    get description(): string {
        return this.value.description;
    }
}

class Branch {
    static main(): Branch {
        return new Branch("main", null, null);
    }

    static release(major: number, minor: number): Branch {
        return new Branch("release", major, minor);
    }

    private constructor(
        public type: "main" | "release",
        public _major: number | null,
        public _minor: number | null
    ) {}

    get description(): string {
        switch (this.type) {
            case "main":
                return "main";
            case "release":
                return `${this._major}.${this._minor} development`;
        }
    }

    get name(): string {
        switch (this.type) {
            case "main":
                return "main";
            case "release":
                return `${this._major}.${this._minor}`;
        }
    }

    get major(): number | null {
        return this._major;
    }

    get minor(): number | null {
        return this._minor;
    }
}

// Snapshot class
class Snapshot {
    // Branch enum

    branch: Branch;
    date: string;

    constructor(branch: Branch, date: string) {
        this.branch = branch;
        this.date = date;
    }

    get description(): string {
        if (this.branch.type === "main") {
            return `main-snapshot-${this.date}`;
        } else {
            return `${this.branch.major}.${this.branch.minor}-snapshot-${this.date}`;
        }
    }
}

class StableRelease {
    major: number;
    minor: number;
    patch: number;

    constructor(major: number, minor: number, patch: number) {
        this.major = major;
        this.minor = minor;
        this.patch = patch;
    }

    get description(): string {
        return `Swift ${this.major}.${this.minor}.${this.patch}`;
    }
}
