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
    private static referenceMap = Object();
    private static nextId = 0;

    private id?: number;

    constructor(value: Ref) {
        this.id = this.newReference(value);
    }

    private newReference(value: Ref): number {
        const id = WeakReference.nextId;
        WeakReference.referenceMap[id] = value;
        WeakReference.nextId += 1;
        return id;
    }

    get value(): Ref|undefined {
        if (this.id === undefined) { return undefined; }
        return WeakReference.referenceMap[this.id];
    }

    set value(value: Ref|undefined) {
        if (this.id === undefined) {
            if (value !== undefined) {
                this.id = this.newReference(value);
            } 
        } else {
            if (value === undefined) {
                this.clear();
            } else {
                WeakReference.referenceMap[this.id] = value;
            }
        }
    }

    clear() {
        if (this.id === undefined) { return undefined; }
        delete WeakReference.referenceMap[this.id];
    }

    dispose() {
        if (this.id === undefined) { return undefined; }
        let value = WeakReference.referenceMap[this.id];
        if (value as { dispose(): any }) {
            value.dispose();
        }
        this.clear();
    }

    static get count() {
        return Object.keys(this.referenceMap).length;
    }

    static clearAll() {
        WeakReference.referenceMap = Object();
    }
}