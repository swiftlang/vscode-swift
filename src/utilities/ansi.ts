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

export const ansiEscapeCodePrefix = "\u{001B}[";
export const resetANSIEscapeCode = `${ansiEscapeCodePrefix}0m`;

/**
 * Utilities for colorizing strings in environments that support rendering ANSI escape codes.
 */
export class StringColor {
    static default(str: string) {
        return wrapANSI("90m", str);
    }

    static red(str: string) {
        return wrapANSI("91m", str);
    }

    static green(str: string) {
        return wrapANSI("92m", str);
    }

    static yellow(str: string) {
        return wrapANSI("93m", str);
    }
}

/**
 * Wrap a string with an ANSI command.
 * @param command The code to use. Supply only the command, omitting the leading escape character and `[`.
 * @param value The value to wrap
 * @returns A wrapped value
 */
export function wrapANSI(command: string, value: string) {
    return `${ansiEscapeCodePrefix}${command}${value}${resetANSIEscapeCode}`;
}

/**
 * Returns true if the supplied string contains an escape sequence that clears the line and resets
 * the cursor to the beginning of the line.
 * @param str A string to check
 * @returns If the escape code exists
 */
export function containsErasedLine(str: string) {
    return str.indexOf(`${ansiEscapeCodePrefix}2K\r`) !== -1;
}
