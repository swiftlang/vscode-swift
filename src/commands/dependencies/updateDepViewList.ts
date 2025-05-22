//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import contextKeys from "../../contextKeys";
import { FolderOperation, WorkspaceContext } from "../../WorkspaceContext";

export function updateDependenciesViewList(ctx: WorkspaceContext, flatList: boolean) {
    if (ctx.currentFolder) {
        contextKeys.flatDependenciesList = flatList;
        void ctx.fireEvent(ctx.currentFolder, FolderOperation.packageViewUpdated);
    }
}
