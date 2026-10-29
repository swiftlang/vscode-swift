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
    ProvideDiagnosticSignature,
    ServerCapabilities,
    vsdiag,
} from "vscode-languageclient";

import { Version } from "../../utilities/version";
import { SourceKitLanguageClient } from "./SourceKitLanguageClient";

/**
 * Check whether or not the language server supports the provided experimental capability.
 *
 * @param caps The {@link ServerCapabilities}
 * @param feature The feature name
 * @param minVersion The minimum supported version number
 * @returns A boolean
 */
export function checkExperimentalCapability(
    caps: ServerCapabilities,
    feature: string,
    minVersion: number
): boolean {
    const version = access(caps.experimental, feature, "version");
    if (typeof version !== "number") {
        return false;
    }
    return version >= minVersion;
}

/**
 * Fills the client's experimental capabilities with the provided feature. Will advertise to the server
 * that the client supports the given experimental feature.
 *
 * @param client The {@link SourceKitLanguageClient}
 * @param capabilities The {@link ClientCapabilities}
 * @param feature The feature name
 * @param options Additional options to add to the capability (Swift >=6.3.0)
 */
export function fillExperimentalCapability(
    client: SourceKitLanguageClient,
    capabilities: ClientCapabilities,
    feature: string,
    options: Record<string, unknown> = {}
): void {
    const experimentalCaps = capabilities.experimental ?? {};
    if (client.swiftVersion.isGreaterThanOrEqual(new Version(6, 3, 0))) {
        experimentalCaps[feature] = { supported: true, ...options };
    } else {
        experimentalCaps[feature] = true;
    }
    capabilities.experimental = experimentalCaps;
}

/**
 * Middleware for pulled diagnostics. vscode-languageclient 9 stops pulling a document's
 * diagnostics after one failed pull (fixed in 11 by microsoft/vscode-languageserver-node#1899),
 * so a failure that isn't a cancellation becomes a report: no diagnostics for a first pull, no
 * change for a later one. The client has already logged the failure.
 */
export async function keepPullingDiagnostics(
    document: vscode.TextDocument | vscode.Uri,
    previousResultId: string | undefined,
    token: vscode.CancellationToken,
    next: ProvideDiagnosticSignature
): Promise<vsdiag.DocumentDiagnosticReport | null | undefined> {
    try {
        return await next(document, previousResultId, token);
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            throw error;
        }
        if (previousResultId) {
            return {
                kind: vsdiag.DocumentDiagnosticReportKind.unChanged,
                resultId: previousResultId,
            };
        }
        return {
            kind: vsdiag.DocumentDiagnosticReportKind.full,
            items: [],
        };
    }
}

function access(obj: unknown, ...properties: string[]): unknown {
    if (properties.length === 0) {
        return obj;
    }

    if (properties.length === 1) {
        const property = properties[0];
        if (obj === undefined || obj === null) {
            return undefined;
        }
        return Object.getOwnPropertyDescriptor(obj, property)?.value;
    }

    let result = obj;
    for (const property of properties) {
        result = access(result, property);
    }
    return result;
}
