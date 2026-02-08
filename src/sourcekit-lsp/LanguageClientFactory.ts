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
import { LanguageClient, LanguageClientOptions, ServerOptions } from "vscode-languageclient/node";

/**
 * Used to create a {@link LanguageClient} for use in VS Code.
 *
 * This is primarily used to make unit testing easier so that we don't have to
 * mock out a constructor in the `vscode-languageclient` module.
 */
export class LanguageClientFactory {
    /**
     * Create a new {@link LanguageClient} for use in VS Code.
     *
     * @param name the human-readable name for the client
     * @param id the identifier for the client (used in settings)
     * @param serverOptions the {@link ServerOptions}
     * @param clientOptions the {@link LanguageClientOptions}
     * @returns the newly created {@link LanguageClient}
     */
    createLanguageClient(
        id: string,
        name: string,
        serverOptions: ServerOptions,
        clientOptions: LanguageClientOptions
    ): LanguageClient {
        return new LanguageClient(id, name, serverOptions, clientOptions);
    }
}
