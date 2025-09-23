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

export const enum SwiftlyErrorCode {
    /** Swiftly is not supported on this OS. */
    OS_NOT_SUPPORTED = "OS_NOT_SUPPORTED",
    /** Swiftly is not installed on this system. */
    NOT_INSTALLED = "NOT_INSTALLED",
    /** The current version of Swiftly does not support this method. */
    METHOD_NOT_SUPPORTED = "METHOD_NOT_SUPPORTED",
    /** An unexpected error occurred. */
    UNKNOWN = "UNKNOWN",
}

function humanReadableErrorCode(code: SwiftlyErrorCode): string {
    switch (code) {
        case SwiftlyErrorCode.OS_NOT_SUPPORTED:
            return "Swiftly is not supported on this OS.";
        case SwiftlyErrorCode.NOT_INSTALLED:
            return "Swiftly is not installed.";
        case SwiftlyErrorCode.METHOD_NOT_SUPPORTED:
            return "This method is not supported by Swiftly.";
        case SwiftlyErrorCode.UNKNOWN:
            return "An unknown error occurred.";
    }
}

/**
 * Represents an error that can happen when invoking Swiftly.
 *
 * Error types can be distinguished via the `code` property.
 */
export class SwiftlyError extends Error {
    static osNotSupported(options: { message?: string; cause?: unknown } = {}): SwiftlyError {
        return new SwiftlyError(SwiftlyErrorCode.OS_NOT_SUPPORTED, options);
    }

    static notInstalled(options: { message?: string; cause?: unknown } = {}): SwiftlyError {
        return new SwiftlyError(SwiftlyErrorCode.NOT_INSTALLED, options);
    }

    static methodNotSupported(options: { message?: string; cause?: unknown } = {}): SwiftlyError {
        return new SwiftlyError(SwiftlyErrorCode.METHOD_NOT_SUPPORTED, options);
    }

    static unknown(options: { message?: string; cause?: unknown } = {}): SwiftlyError {
        return new SwiftlyError(SwiftlyErrorCode.UNKNOWN, options);
    }

    constructor(
        public readonly code: SwiftlyErrorCode,
        options: { message?: string; cause?: unknown }
    ) {
        super(options.message ?? humanReadableErrorCode(code), {
            cause: options.cause,
        });
        this.name = "SwiftlyError";
    }
}
