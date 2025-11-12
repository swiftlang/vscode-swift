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

import * as vscode from "vscode";

import { SwiftExtensionApi } from "./SwiftExtensionApi";
import { WorkspaceContext } from "./WorkspaceContext";
import { ContextKeys } from "./contextKeys";
import { SwiftLogger } from "./logging/SwiftLogger";

/**
 * External API as exposed by the extension. Can be queried by other extensions
 * or by the integration test runner for VS Code extensions.
 */
export interface Api {
    /**
     * The {@link WorkspaceContext} if it is currently available.
     *
     * The Swift extension starting in 2.16.0 delays workspace initialization in order to
     * speed up activation. Use {@link waitForWorkspaceContext} or {@link withWorkspaceContext}
     * to wait for the workspace to be initialized.
     */
    workspaceContext?: WorkspaceContext;

    /**
     * Can be used to query for the Swift extension's [context keys](https://code.visualstudio.com/api/references/when-clause-contexts#add-a-custom-when-clause-context).
     *
     * **DO NOT** edit these context keys outside of the Swift extension. This will cause
     * the extension to not behave correctly.
     */
    contextKeys: ContextKeys;

    /**
     * The {@link SwiftLogger} used by the extension to log behavior.
     */
    logger: SwiftLogger;

    /**
     * Waits for workspace initialization to complete and returns the {@link WorkspaceContext}.
     */
    waitForWorkspaceContext(): Promise<WorkspaceContext>;

    /**
     * Waits for workspace initialization to complete and executes the provided task, passing
     * in the {@link WorkspaceContext}.
     *
     * @param task The task to execute after the workspace has finished initialization.
     * @param token An optional cancellation token used to cancel the task.
     */
    withWorkspaceContext<T>(
        task: (ctx: WorkspaceContext) => T | Promise<T>,
        token?: vscode.CancellationToken
    ): Promise<T>;

    /**
     * Activate the extension.
     *
     * **DO NOT** use this method directly. It is exposed for testing purposes only.
     *
     * @param callSite An optional call site used to determine where the extension was activated from.
     */
    activate(callSite?: Error): void;

    /**
     * Deactivate the extension.
     *
     * **DO NOT** use this method directly. It is exposed for testing purposes only.
     */
    deactivate(): void;

    /**
     * Dispose of the API.
     *
     * **DO NOT** use this method directly. It is exposed for testing purposes only.
     */
    dispose(): void;
}

let extensionApi: Api | undefined = undefined;

/**
 * Activate the extension. This is the main entry point.
 */
export async function activate(context: vscode.ExtensionContext): Promise<Api> {
    extensionApi = new SwiftExtensionApi(context);
    extensionApi.activate();
    return extensionApi;
}

export function deactivate(): void {
    extensionApi?.deactivate();
    extensionApi?.dispose();
}
