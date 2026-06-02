//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { FolderContext } from "../FolderContext";
import { checkExperimentalCapability } from "../sourcekit-lsp/LanguageClientManager";
import { LanguageClientManager } from "../sourcekit-lsp/LanguageClientManager";
import { Playground, WorkspacePlaygroundsRequest } from "../sourcekit-lsp/extensions";
import { Version } from "../utilities/version";

export { Playground };

/**
 * Uses document symbol request to keep a running copy of all the test methods
 * in a file. When a file is saved it checks to see if any new methods have been
 * added, or if any methods have been removed and edits the test items based on
 * these results.
 */
export class LSPPlaygroundsDiscovery {
    private languageClient: LanguageClientManager;
    private toolchainVersion: Version;

    constructor(folderContext: FolderContext) {
        this.languageClient = folderContext.languageClientManager;
        this.toolchainVersion = folderContext.toolchain.swiftVersion;
    }

    /**
     * Return list of workspace playgrounds
     */
    async getWorkspacePlaygrounds(): Promise<Playground[]> {
        return await this.languageClient.useLanguageClient(async (client, token) => {
            // Only use the lsp for this request if it supports the
            // workspace/playgrounds method.
            if (checkExperimentalCapability(client, WorkspacePlaygroundsRequest.method, 1)) {
                return await client.sendRequest(WorkspacePlaygroundsRequest.type, token);
            } else {
                throw new Error(`${WorkspacePlaygroundsRequest.method} requests not supported`);
            }
        });
    }

    async supportsPlaygrounds(): Promise<boolean> {
        if (this.toolchainVersion.isLessThan(new Version(6, 3, 0))) {
            return false;
        }
        return await this.languageClient.useLanguageClient(async client => {
            return checkExperimentalCapability(client, WorkspacePlaygroundsRequest.method, 1);
        });
    }
}
