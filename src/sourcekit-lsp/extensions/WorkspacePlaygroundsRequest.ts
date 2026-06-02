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
// We use namespaces to store request information just like vscode-languageclient
/* eslint-disable @typescript-eslint/no-namespace */
import { Location, MessageDirection, RequestType0 } from "vscode-languageclient";

/** Represents a single test returned from a {@link WorkspacePlaygroundsRequest}. */
export interface Playground {
    /**
     * Unique identifier for the `Playground` with the format `<target>/<filename>:<line>:[column]` where `target`
     * corresponds to the Swift package's target where the playground is defined, `filename` is the basename of the file
     * (not entire relative path), and `column` is optional only required if multiple playgrounds are defined on the same
     * line. Client can run the playground by executing `swift play <id>`.
     *
     * This property is always present whether the `Playground` has a `label` or not.
     *
     * Follows the format output by `swift play --list`.
     */
    id: string;

    /**
     * The label that can be used as a display name for the playground. This optional property is only available
     *  for named playgrounds. For example: `#Playground("hello") { print("Hello!) }` would have a `label` of `"hello"`.
     */
    label?: string;

    /**
     * The location of where the #Playground macro was used in the source code.
     */
    location: Location;
}

/**
 * A request that returns symbols for all the playgrounds within the current workspace.
 *
 * ### LSP Extension
 *
 * This request is an extension to LSP supported by SourceKit-LSP.
 *
 * It requires the experimental client capability `"workspace/playgrounds"` to use.
 */
export namespace WorkspacePlaygroundsRequest {
    export const method = "workspace/playgrounds" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType0<Playground[], never>(method);
}
