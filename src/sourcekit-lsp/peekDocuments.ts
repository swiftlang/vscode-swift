//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as langclient from "vscode-languageclient/node";
import { PeekDocumentsParams, PeekDocumentsRequest } from "./lspExtensions";

/**
 * Opens a peeked editor in `uri` at `position` having contents from `locations`.
 *
 * **NOTE**:
 * - If the `uri` is not open in the editor, this opens the `uri` in the editor and then opens a peeked editor.
 * - This closes any previously displayed peeked editor in `uri` and then, reopens a peeked editor in `uri` at
 *   the given `position` with contents from the new `locations`.
 *
 * @param uri The uri of the file in which a peeked editor is to be opened
 * @param position The position in the file in which a peeked editor is to be opened
 * @param locations The locations of the contents which has to be displayed by the peeked editor
 */
async function openPeekedEditorIn(
    uri: vscode.Uri,
    position: vscode.Position,
    locations: vscode.Location[]
) {
    // #### NOTE - Undocumented behaviour of invoking VS Code's built-in "editor.action.peekLocations" command:
    // 1. If the `uri` is not open in the editor, it opens the `uri` in the editor and then opens a peeked editor.
    // 2. It always closes the previous peeked editor (If any)
    // 3. And after closing, It opens a new peeked editor having the contents of `locations` in `uri` **if and only
    //    if** the previous peeked editor was displayed at a *different* `position` in `uri`.
    // 4. If it happens to be that the previous peeked editor was displayed at the *same* `position` in `uri`, then it
    //    doesn't open the peeked editor window having the contents of new `locations` at all.

    // As (4.) says above, if we invoke "editor.action.peekLocations" on a position in which another peeked editor
    // window is already being shown, it won't cause the new peeked editor window to show up at all. This is not the
    // ideal behaviour.
    //
    // For example:
    // If there's already a peeked editor window at the position (2, 2) in "main.swift", its impossible to close this
    // peeked editor window and open a new peeked editor window at the same position (2, 2) in "main.swift" by invoking
    // the "editor.action.peekLocations" command in a single call.
    //
    // *The ideal behaviour* is to close any previously opened peeked editor window and then open the new one without
    // any regard to its `position` in the `uri`.

    // In order to achieve *the ideal behaviour*, we manually close the peeked editor window by ourselves before
    // opening a new peeked editor window.
    //
    // Since there isn't any API available to close the previous peeked editor, as a **workaround**, we open a dummy
    // peeked editor at a different position, causing the previous one to close irrespective of where it is. After
    // which we can invoke the command again to show the actual peeked window having the contents of the `locations`.
    await vscode.commands.executeCommand(
        "editor.action.peekLocations",
        uri,
        new vscode.Position(position.line, position.character !== 0 ? position.character - 1 : 1),
        [new vscode.Location(vscode.Uri.parse(""), new vscode.Position(0, 0))],
        "peek"
    );

    // Opens the actual peeked editor window
    await vscode.commands.executeCommand(
        "editor.action.peekLocations",
        uri,
        position,
        locations,
        "peek"
    );
}

export function activatePeekDocuments(client: langclient.LanguageClient): vscode.Disposable {
    const peekDocuments = client.onRequest(
        PeekDocumentsRequest.method,
        async (params: PeekDocumentsParams) => {
            const peekURI = client.protocol2CodeConverter.asUri(params.uri);

            const peekPosition = new vscode.Position(
                params.position.line,
                params.position.character
            );

            const peekLocations = params.locations.map(
                location =>
                    new vscode.Location(
                        client.protocol2CodeConverter.asUri(location),
                        new vscode.Position(0, 0)
                    )
            );

            openPeekedEditorIn(peekURI, peekPosition, peekLocations);

            return { success: true };
        }
    );

    return peekDocuments;
}
