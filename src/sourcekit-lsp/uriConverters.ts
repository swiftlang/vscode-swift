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

import * as vscode from "vscode";

export const uriConverters = {
    code2Protocol: (value: vscode.Uri) => {
        if (value.scheme === "sourcekit-lsp") {
            // Custom encoding for `sourcekit-lsp://` requests having a `parent` parameter which
            // can be a `file://` URL or a `sourcekit-lsp://` URL.
            const scheme = value.scheme;
            const authority = value.authority;
            const path = value.path;
            const fragment = value.fragment;

            let query = value.query;

            const parentParameter = "parent=";
            const parentParameterIndex = query.indexOf("parent=");

            if (parentParameterIndex === -1) {
                // No need to do this encoding if there's no parent parameter in the
                // reference document URL

                // Same as the default implementation
                return value.toString();
            }

            // Apply encoding from the start of the value of the `parent` parameter's value
            // till the end of the url string (`parent` parameter is the last parameter of the
            // reference document url)

            const startIndex = parentParameterIndex + parentParameter.length;

            const before = query.slice(0, startIndex);
            const toEncode = query.slice(startIndex);

            // Replace only the percent, equals, ampersand signs
            // This is inline with how sourcekit-lsp handles the URLs in its test cases.
            const encoded = toEncode.replace(/%/g, "%25").replace(/=/g, "%3D").replace(/&/g, "%26");

            query = before + encoded;

            let uriString = scheme + "://" + authority + path;

            if (query !== "" && query !== null) {
                uriString += "?" + query;
            }

            if (fragment !== "" && fragment !== null) {
                uriString += "#" + fragment;
            }

            return uriString;
        } else {
            // Same as the default implementation
            return value.toString();
        }
    },
    protocol2Code: (value: string) => {
        // Same as the default implementation
        return vscode.Uri.parse(value);
    },
};
