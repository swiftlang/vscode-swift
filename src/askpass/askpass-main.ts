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
/* eslint-disable no-console */
import * as fs from "fs";
import * as http from "http";
import { z } from "zod/v4/mini";

const outputFile = process.env.VSCODE_SWIFT_ASKPASS_FILE;
if (!outputFile) {
    throw new Error("Missing environment variable $VSCODE_SWIFT_ASKPASS_FILE");
}

const nonce = process.env.VSCODE_SWIFT_ASKPASS_NONCE;
if (!nonce) {
    throw new Error("Missing environment variable $VSCODE_SWIFT_ASKPASS_NONCE");
}

const port = Number.parseInt(process.env.VSCODE_SWIFT_ASKPASS_PORT ?? "-1", 10);
if (isNaN(port) || port < 0) {
    throw new Error("Missing environment variable $VSCODE_SWIFT_ASKPASS_PORT");
}

const req = http.request(
    {
        hostname: "localhost",
        port: port,
        path: `/askpass?nonce=${encodeURIComponent(nonce)}`,
        method: "GET",
    },
    res => {
        function parseResponse(rawData: string): { password?: string } {
            try {
                const rawJSON = JSON.parse(rawData);
                return z.object({ password: z.optional(z.string()) }).parse(rawJSON);
            } catch {
                // DO NOT log the underlying error here. It contains sensitive password info!
                throw Error("Failed to parse response from askpass server.");
            }
        }

        let rawData = "";
        res.on("data", chunk => {
            rawData += chunk;
        });

        res.on("end", () => {
            if (res.statusCode !== 200) {
                console.error(`Server responded with status code ${res.statusCode}`);
                process.exit(1);
            }
            const password = parseResponse(rawData).password;
            if (!password) {
                console.error("User cancelled password input.");
                process.exit(1);
            }
            try {
                fs.writeFileSync(outputFile, password, "utf8");
            } catch (error) {
                console.error(Error(`Unable to write to file ${outputFile}`, { cause: error }));
                process.exit(1);
            }
        });
    }
);

req.on("error", error => {
    console.error(Error(`Request failed: GET ${req.host}/${req.path}`, { cause: error }));
    process.exit(1);
});

req.end();
