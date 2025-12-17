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
import { DefaultArtifactClient } from "@actions/artifact";
import { readdir } from "fs/promises";
import * as path from "path";

import { isErrnoException, main } from "./lib/utilities";

main(async () => {
    try {
        const testResultsDirectory = path.join(__dirname, "../test-results");
        const files = (await readdir(testResultsDirectory, { recursive: true })).map(file =>
            path.join(testResultsDirectory, file)
        );
        const artifact = new DefaultArtifactClient();
        await artifact.uploadArtifact("test-results", files, testResultsDirectory);
    } catch (error) {
        if (isErrnoException(error) && error.code === "ENOENT") {
            return; // The test-results folder does not exist and shouldn't be uploaded
        }
        throw error;
    }
});
