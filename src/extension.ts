//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
// Use source-map-support to get better stack traces
import "source-map-support/register";

import * as fs from "fs/promises";
import * as vscode from "vscode";

import { InternalSwiftExtensionApi } from "./InternalSwiftExtensionApi";
import { SwiftExtensionApi } from "./SwiftExtensionApi";
import { Version } from "./utilities/version";

let swiftExtensionApi: InternalSwiftExtensionApi | undefined = undefined;

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext): Promise<SwiftExtensionApi> {
    const apiVersion = await getApiVersionNumber(context);
    swiftExtensionApi = new InternalSwiftExtensionApi(apiVersion, context);
    swiftExtensionApi.activate();
    return swiftExtensionApi;
}

export function deactivate(): void {
    swiftExtensionApi?.deactivate();
    swiftExtensionApi?.dispose();
    swiftExtensionApi = undefined;
}

async function getApiVersionNumber(context: vscode.ExtensionContext): Promise<Version> {
    try {
        const packageJsonPath = context.asAbsolutePath("package.json");
        const packageJsonRaw = await fs.readFile(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(packageJsonRaw);
        const apiVersionRaw = packageJson["api-version"];
        if (!apiVersionRaw || typeof apiVersionRaw !== "string") {
            throw Error(
                `The "api-version" property in the package.json is missing or invalid: ${JSON.stringify(apiVersionRaw)}`
            );
        }
        const apiVersion = Version.fromString(apiVersionRaw);
        if (!apiVersion) {
            throw Error(
                `Unable to parse the "api-version" string from the package.json: "${apiVersionRaw}"`
            );
        }
        return apiVersion;
    } catch (error) {
        throw Error("Failed to load the Swift extension API version number from the package.json", {
            cause: error,
        });
    }
}
