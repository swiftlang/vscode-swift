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
import {
    ClientCapabilities,
    FeatureState,
    ServerCapabilities,
    State,
    StaticFeature,
    TextDocumentIdentifier,
} from "vscode-languageclient";

import { Disposable } from "../../../utilities/Disposable";
import { DidChangeActiveDocumentNotification } from "../../extensions/DidChangeActiveDocumentRequest";
import { SourceKitLanguageClient } from "../SourceKitLanguageClient";
import { checkExperimentalCapability, fillExperimentalCapability } from "../utilities";

export class ActiveDocumentFeature implements StaticFeature {
    private lastActiveDocument: TextDocumentIdentifier | null = null;
    private subscriptions: Disposable[] = [];

    constructor(private readonly client: SourceKitLanguageClient) {}

    fillClientCapabilities(capabilities: ClientCapabilities): void {
        fillExperimentalCapability(
            this.client,
            capabilities,
            DidChangeActiveDocumentNotification.method
        );
    }

    initialize(capabilities: ServerCapabilities): void {
        if (
            !checkExperimentalCapability(
                capabilities,
                DidChangeActiveDocumentNotification.method,
                1
            )
        ) {
            return;
        }
        this.subscriptions.push(
            this.client.onDidChangeState(event => {
                switch (event.newState) {
                    case State.Starting:
                    case State.Stopped:
                        this.lastActiveDocument = null;
                        break;
                    case State.Running:
                        this.sendNotification(vscode.window.activeTextEditor?.document);
                        break;
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.sendNotification(editor?.document);
            })
        );
        this.sendNotification(vscode.window.activeTextEditor?.document);
    }

    getState(): FeatureState {
        return { kind: "static" };
    }

    clear(): void {
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
        this.lastActiveDocument = null;
    }

    private sendNotification(document: vscode.TextDocument | undefined): void {
        const textDocument = document
            ? this.client.code2ProtocolConverter.asTextDocumentIdentifier(document)
            : null;
        if (textDocument?.uri === this.lastActiveDocument?.uri) {
            return;
        }
        this.lastActiveDocument = textDocument;
        void this.client.sendNotification(DidChangeActiveDocumentNotification.method, {
            textDocument: textDocument,
        });
    }
}
