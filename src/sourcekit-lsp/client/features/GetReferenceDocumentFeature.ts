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
import * as vscode from "vscode";
import { ClientCapabilities, FeatureState, StaticFeature } from "vscode-languageclient";

import { Disposable } from "../../../utilities/Disposable";
import { GetReferenceDocumentParams, GetReferenceDocumentRequest } from "../../extensions";
import { SourceKitLanguageClient } from "../SourceKitLanguageClient";
import { fillExperimentalCapability } from "../utilities";

export class GetReferenceDocumentFeature implements StaticFeature {
    private subscriptions: Disposable[] = [];

    constructor(private readonly client: SourceKitLanguageClient) {}

    fillClientCapabilities(capabilities: ClientCapabilities): void {
        fillExperimentalCapability(this.client, capabilities, GetReferenceDocumentRequest.method);
    }

    initialize(): void {
        this.subscriptions.push(
            vscode.workspace.registerTextDocumentContentProvider("sourcekit-lsp", {
                provideTextDocumentContent: async (uri, token) => {
                    const params: GetReferenceDocumentParams = {
                        uri: this.client.code2ProtocolConverter.asUri(uri),
                    };

                    const result = await this.client.sendRequest(
                        GetReferenceDocumentRequest.type,
                        params,
                        token
                    );

                    if (result) {
                        return result.content;
                    } else {
                        return "Unable to retrieve reference document";
                    }
                },
            })
        );
    }

    getState(): FeatureState {
        return { kind: "static" };
    }

    clear(): void {
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
    }
}
