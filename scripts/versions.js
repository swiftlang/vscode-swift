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
 * Formats the given date as a string in the form "YYYYMMdd".
 *
 * @param date The date to format as a string.
 * @returns The formatted date.
 */
function formatDate(date) {
    const year = date.getUTCFullYear().toString().padStart(4, "0");
    const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = date.getUTCDate().toString().padStart(2, "0");
    return year + month + day;
}

module.exports = {
    preview: function (version) {
        const minor = version.minor + 1;
        const patch = formatDate(new Date());
        return `${version.major}.${minor}.${patch}`;
    },
    dev: function (version) {
        const patch = version.patch + 1;
        return `${version.major}.${version.minor}.${patch}-dev`;
    },
};
