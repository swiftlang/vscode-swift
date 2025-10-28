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
import * as crypto from "crypto";
import * as http from "http";
import * as vscode from "vscode";

/** Options that can be used to configure the behavior of {@link withAskpassServer}. */
export interface WithAskpassServerOptions {
    /** The title of the input box shown in VS Code. */
    title?: string;
}

/**
 * Creates a temporary HTTP server that can be used to handle askpass requests from various terminal
 * applications. The server will be closed when the provided task completes.
 *
 * The task will be provided with a randomly generated nonce and port number used for connecting to
 * the server. Requests without a valid nonce will be rejected with a 401 status code.
 *
 * @param task Function to execute while the server is listening for connections
 * @returns Promise that resolves when the task completes and server is cleaned up
 */
export async function withAskpassServer<T>(
    task: (nonce: string, port: number) => Promise<T>,
    options: WithAskpassServerOptions = {}
): Promise<T> {
    const nonce = crypto.randomBytes(32).toString("hex");
    const server = http.createServer((req, res) => {
        if (!req.url) {
            return res.writeHead(404).end();
        }

        const url = new URL(req.url, `http://localhost`);
        if (url.pathname !== "/askpass") {
            return res.writeHead(404).end();
        }

        const requestNonce = url.searchParams.get("nonce");
        if (requestNonce !== nonce) {
            return res.writeHead(401).end();
        }

        void vscode.window
            .showInputBox({
                password: true,
                title: options.title,
                placeHolder: "Please enter your password",
                ignoreFocusOut: true,
            })
            .then(password => {
                res.writeHead(200, { "Content-Type": "application/json" }).end(
                    JSON.stringify({ password })
                );
            });
    });

    return new Promise((resolve, reject) => {
        server.listen(0, "localhost", async () => {
            try {
                const address = server.address();
                if (!address || typeof address === "string") {
                    throw new Error("Failed to get server port");
                }
                const port = address.port;
                resolve(await task(nonce, port));
            } catch (error) {
                reject(error);
            } finally {
                server.close();
            }
        });

        server.on("error", error => {
            reject(error);
        });
    });
}
