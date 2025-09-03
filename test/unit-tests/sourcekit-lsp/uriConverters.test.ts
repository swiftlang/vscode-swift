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

import { expect } from "chai";
import * as vscode from "vscode";
import { uriConverters } from "@src/sourcekit-lsp/uriConverters";

/// Check that decoding the given URI string and re-encoding it results in the original string and that the decoded Uri
/// does not cause any assertion failures in `verifyUri`.
function checkUri(input: string, verifyUri: (uri: vscode.Uri) => void) {
    const uri = uriConverters.protocol2Code(input);
    verifyUri(uri);
    expect(uriConverters.code2Protocol(uri)).to.equal(input);
}

suite("uriConverters Suite", () => {
    suite("Default Coding", () => {
        test("Space in host", () => {
            checkUri("file://host%20with%20space/", uri => {
                expect(uri.authority).to.equal("host with space");
            });
        });

        test("Space in path", () => {
            checkUri("file://host/with%20space", uri => {
                expect(uri.path).to.equal("/with space");
            });
        });

        test("Query does not round-trip", () => {
            // If this test starts passing, the underlying VS Code issue that requires us to have custom URI coding
            // has been fixed and we should be able to remove our custom uri converter.
            const uri = uriConverters.protocol2Code("scheme://host?outer=inner%3Dvalue");
            expect(uri.toString(/*skipEncoding*/ false)).to.equal(
                "scheme://host?outer%3Dinner%3Dvalue"
            );
            expect(uri.toString(/*skipEncoding*/ true)).to.equal("scheme://host?outer=inner=value");
        });
    });

    suite("Custom Coding", () => {
        test("Basic", () => {
            checkUri("sourcekit-lsp://host?outer=inner%3Dvalue", uri => {
                expect(uri.query).to.equal("outer=inner%3Dvalue");
            });
        });

        test("Percent-encoded hash in query", () => {
            checkUri("sourcekit-lsp://host?outer=with%23hash", uri => {
                expect(uri.query).to.equal("outer=with%23hash");
            });
        });

        test("Query and fragment", () => {
            checkUri("sourcekit-lsp://host?outer=with%23hash#fragment", uri => {
                expect(uri.query).to.equal("outer=with%23hash");
                expect(uri.fragment).to.equal("fragment");
            });
        });

        test("Percent encoding in host", () => {
            // Technically, it would be nice to percent-decode the authority and path here but then we get into
            // ambiguities around username in the authority (see the `Encoded '@' in host` test).
            // For now, rely on SourceKit-LSP not using any characters that need percent-encoding here.
            checkUri("sourcekit-lsp://host%20with%20space", uri => {
                expect(uri.authority).to.equal("host%20with%20space");
            });
        });

        test("Encoded '@' in host", () => {
            checkUri("sourcekit-lsp://user%40with-at@host%40with-at", uri => {
                expect(uri.authority).to.equal("user%40with-at@host%40with-at");
            });
        });

        test("Percent encoding in path", () => {
            checkUri("sourcekit-lsp://host/with%20space", uri => {
                expect(uri.path).to.equal("/with%20space");
            });
        });

        test("No query", () => {
            checkUri("sourcekit-lsp://host/with/path", uri => {
                expect(uri.query).to.equal("");
            });
        });

        test("With username", () => {
            checkUri("sourcekit-lsp://user@host", uri => {
                expect(uri.authority).to.equal("user@host");
            });
        });

        test("With username and password", () => {
            checkUri("sourcekit-lsp://user:pass@host", uri => {
                expect(uri.authority).to.equal("user:pass@host");
            });
        });
    });
});
