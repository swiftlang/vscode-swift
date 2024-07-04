import * as vscode from "vscode";
import * as langclient from "vscode-languageclient/node";
import { PeekDocumentsParams, PeekDocumentsRequest } from "./lspExtensions";

export function activatePeekDocuments(client: langclient.LanguageClient): vscode.Disposable {
    const peekDocuments = client.onRequest(
        PeekDocumentsRequest.method,
        async (params: PeekDocumentsParams) => {
            const locations = params.locations.map(uri => {
                const location = new vscode.Location(
                    vscode.Uri.from({
                        scheme: "file",
                        path: new URL(uri).pathname,
                    }),
                    new vscode.Position(0, 0)
                );

                return location;
            });

            await vscode.commands.executeCommand(
                "editor.action.peekLocations",
                vscode.Uri.from({
                    scheme: "file",
                    path: new URL(params.uri).pathname,
                }),
                new vscode.Position(params.position.line, params.position.character),
                locations,
                "peek"
            );

            return { success: true };
        }
    );

    return peekDocuments;
}
