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
    MessageType,
    StaticFeature,
} from "vscode-languageclient";

import { Disposable } from "../../../utilities/Disposable";
import { SourceKitLogMessageNotification, SourceKitLogMessageParams } from "../../extensions";
import { SourceKitLanguageClient } from "../SourceKitLanguageClient";

export class LoggingFeature implements StaticFeature {
    private outputChannels: Map<string, vscode.OutputChannel>;
    private subscriptions: Disposable[];

    constructor(private readonly client: SourceKitLanguageClient) {
        this.outputChannels = new Map();
        this.subscriptions = [];
    }

    initialize(): void {
        this.subscriptions.push(
            this.client.onNotification(
                SourceKitLogMessageNotification.type,
                this.handleLogMessageNotification.bind(this)
            )
        );
    }

    getState(): FeatureState {
        return { kind: "static" };
    }

    fillClientCapabilities(_capabilities: ClientCapabilities): void {
        // No capabilities needed for logging
    }

    clear(): void {
        this.subscriptions.forEach(s => s.dispose());
        this.subscriptions = [];
        this.outputChannels.forEach(channel => channel.dispose());
        this.outputChannels.clear();
    }

    private getOutputChannel(name: string): vscode.OutputChannel {
        const nameWithVersion = `${name} (${this.client.swiftVersion})`;
        const existing = this.outputChannels.get(nameWithVersion);
        if (existing) {
            return existing;
        }
        const channel = vscode.window.createOutputChannel(nameWithVersion, "swift");
        this.outputChannels.set(nameWithVersion, channel);
        return channel;
    }

    private handleLogMessageNotification(params: SourceKitLogMessageParams): void {
        let channel = this.client.outputChannel;
        if (params.logName) {
            channel = this.getOutputChannel(params.logName);
        }
        switch (params.type) {
            case MessageType.Debug:
                channel.append("[Debug] ");
                break;
            case MessageType.Log:
            case MessageType.Info:
                channel.append("[Info]  ");
                break;
            case MessageType.Warning:
                channel.append("[Warn]  ");
                break;
            case MessageType.Error:
                channel.append("[Error] ");
                break;
        }
        channel.appendLine(params.message);
    }
}
