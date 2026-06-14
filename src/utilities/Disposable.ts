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

export class Disposable {
    static from(...disposables: Disposable[]): Disposable {
        return {
            dispose(): void {
                disposables.forEach(d => d.dispose());
            },
        };
    }

    constructor(public dispose: () => void) {}
}

export class AsyncDisposable {
    static from(...disposables: AsyncDisposable[]): AsyncDisposable {
        return {
            async dispose(): Promise<void> {
                await Promise.all(disposables.map(d => d.dispose()));
            },
        };
    }

    constructor(public dispose: () => Promise<void>) {}
}
