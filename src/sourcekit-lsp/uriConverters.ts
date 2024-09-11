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
    protocol2Code: (value: string): vscode.Uri => {
        if (!value.startsWith("sourcekit-lsp:")) {
            // Use the default implementation for all schemes other than sourcekit-lsp, as defined here:
            // https://github.com/microsoft/vscode-languageserver-node/blob/14ddabfc22187b698e83ecde072247aa40727308/client/src/common/protocolConverter.ts#L286
            return vscode.Uri.parse(value);
        }

        // vscode.uri fails to round-trip URIs that have both a `=` and `%3D` (percent-encoded `=`) in the query component.
        // ```ts
        // vscode.Uri.parse("scheme://host?outer=inner%3Dvalue").toString() -> 'scheme://host?outer%3Dinner%3Dvalue'
        // vscode.Uri.parse("scheme://host?outer=inner%3Dvalue").toString(/*skipEncoding*/ true) -> 'scheme://host?outer=inner=value'
        // ```
        // The SourceKit-LSP scheme relies heavily on encoding options in the query parameters, eg. for Swift macro
        // expansions and the values of those query parameters might contain percent-encoded `=` signs.
        //
        // To work around the round-trip issue, use the URL type from Node.js to parse the URI and then map the URL
        // components to the Uri components in VS Code.
        const url = new URL(value);
        let scheme = url.protocol;
        if (scheme.endsWith(":")) {
            // URL considers ':' part of the protocol, `vscode.URI` does not consider it part of the scheme.
            scheme = scheme.substring(0, scheme.length - 1);
        }

        let auth = url.username;
        if (url.password) {
            auth += ":" + url.password;
        }
        let host = url.host;
        if (auth) {
            host = auth + "@" + host;
        }

        let query = url.search;
        if (query.startsWith("?")) {
            // URL considers '?' not part of the search, `vscode.URI` does consider '?' part of the query.
            query = query.substring(1);
        }

        let fragment = url.hash;
        if (fragment.startsWith("#")) {
            // URL considers '#' not part of the hash, `vscode.URI` does consider '#' part of the fragment.
            fragment = fragment.substring(1);
        }

        return vscode.Uri.from({
            scheme: scheme,
            authority: host,
            path: url.pathname,
            query: query,
            fragment: fragment,
        });
    },
    code2Protocol: (value: vscode.Uri): string => {
        if (value.scheme !== "sourcekit-lsp") {
            // Use the default implementation for all schemes other than sourcekit-lsp, as defined here:
            // https://github.com/microsoft/vscode-languageserver-node/blob/14ddabfc22187b698e83ecde072247aa40727308/client/src/common/codeConverter.ts#L155
            return value.toString();
        }
        // Create a dummy URL. We set all the components below.
        const url = new URL(value.scheme + "://");

        // Uri encodes username and password in `authority`. Url has its custom fields for those.
        let host: string;
        let username: string;
        let password: string;
        const atInAuthority = value.authority.indexOf("@");
        if (atInAuthority !== -1) {
            host = value.authority.substring(atInAuthority + 1);
            const auth = value.authority.substring(0, atInAuthority);
            const colonInAuth = auth.indexOf(":");
            if (colonInAuth === -1) {
                username = auth;
                password = "";
            } else {
                username = auth.substring(0, colonInAuth);
                password = auth.substring(colonInAuth + 1);
            }
        } else {
            host = value.authority;
            username = "";
            password = "";
        }

        // Need to set host before username and password because otherwise setting username + password is a no-op (probably
        // because a URL can't have a username without a host).
        url.host = host;
        url.username = username;
        url.password = password;
        url.pathname = value.path;

        let search = value.query;
        if (search) {
            // URL considers '?' not part of the search, vscode.URI does '?' part of the query.
            search = "?" + search;
        }
        url.search = search;

        let hash = value.fragment;
        if (hash) {
            // URL considers '#' not part of the hash, vscode.URI does '#' part of the fragment.
            hash = "#" + hash;
        }
        url.hash = hash;

        return url.toString();
    },
};
