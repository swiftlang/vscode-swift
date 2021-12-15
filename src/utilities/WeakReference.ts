//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

// Class to generate a weak reference to an object
export class WeakReference<Ref> {
    static referenceMap = Object();
    static nextId = 0;

    private id: number;

    public constructor(ref: Ref) {
        this.id = WeakReference.nextId;
        WeakReference.referenceMap[this.id] = ref;
        WeakReference.nextId += 1;
    }

    public get value(): Ref|undefined {
        return WeakReference.referenceMap[this.id];
    }

    public set value(value: Ref|undefined) {
        WeakReference.referenceMap[this.id] = value;
    }

    dispose() {
        let value = WeakReference.referenceMap[this.id];
        if (value as { dispose(): any }) {
            value.dispose();
        }
        WeakReference.referenceMap[this.id] = undefined;
    }
}