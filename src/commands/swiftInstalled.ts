//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import * as child_process from "child_process";
import { promisify } from "util";

const exec = promisify(child_process.exec);

export async function swiftInstalled(): Promise<boolean> {
    try {
        await exec("swift --version");
        return true;
    } catch (error) {
        return false;
    }
}
