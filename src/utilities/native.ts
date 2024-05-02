//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2024 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";

// To not electron-rebuild for every platform and arch, we want to
// use the asar bundled native module. Taking inspiration from
// https://github.com/microsoft/node-pty/issues/582
export function requireNativeModule<T>(id: string): T {
    if (vscode.env.remoteName) {
        return require(`${vscode.env.appRoot}/node_modules/${id}`);
    }
    return require(`${vscode.env.appRoot}/node_modules.asar/${id}`);
}
