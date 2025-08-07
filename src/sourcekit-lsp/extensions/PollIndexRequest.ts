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

import { MessageDirection, RequestType } from "vscode-languageclient";

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace PollIndexRequest {
    export const method = "workspace/_pollIndex" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<object, object, never>(method);
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace WorkspaceSynchronizeRequest {
    export const method = "workspace/synchronize" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<object, object, never>(method);
}
