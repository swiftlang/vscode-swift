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
import { ClientCapabilities, ServerCapabilities } from "vscode-languageclient";

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
