//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

export class Version {
    constructor(readonly major: number, readonly minor: number, readonly patch: number) {}

    static fromString(s: string): Version | undefined {
        const numbers = s.match(/(\d+).(\d+)(?:.(\d+))?/);
        if (numbers) {
            const major = parseInt(numbers[1]);
            const minor = parseInt(numbers[2]);
            if (numbers[3] === undefined) {
                return new Version(major, minor, 0);
            } else {
                const patch = parseInt(numbers[3]);
                return new Version(major, minor, patch);
            }
        }
        return undefined;
    }

    isLessThan(rhs: Version): boolean {
        if (this.major < rhs.major) {
            return true;
        } else if (this.major > rhs.major) {
            return false;
        }
        if (this.minor < rhs.minor) {
            return true;
        } else if (this.minor > rhs.minor) {
            return false;
        }
        if (this.patch < rhs.patch) {
            return true;
        }
        return false;
    }

    isGreaterThan(rhs: Version): boolean {
        if (this.major > rhs.major) {
            return true;
        } else if (this.major < rhs.major) {
            return false;
        }
        if (this.minor > rhs.minor) {
            return true;
        } else if (this.minor < rhs.minor) {
            return false;
        }
        if (this.patch > rhs.patch) {
            return true;
        }
        return false;
    }

    isLessThanOrEqual(rhs: Version): boolean {
        return !this.isGreaterThan(rhs);
    }

    isGreaterThanOrEqual(rhs: Version): boolean {
        return !this.isLessThan(rhs);
    }
}
