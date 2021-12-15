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

import * as assert from 'assert';
import { WeakReference } from '../../utilities/WeakReference';

suite('WeakReference Test Suite', () => {
	test('get', () => {
        const value = {"a": 2, "b": "test"};
        const ref = new WeakReference(value);
		assert.strictEqual(ref.value, value);
        WeakReference.clearAll();
    });
    
	test('set and get', () => {
        const value = {"a": 1, "b": "test"};
        const ref = new WeakReference({"a": 2, "b": "test"});
        ref.value = value;
		assert.strictEqual(ref.value, value);
        assert.strictEqual(WeakReference.count, 1);
        WeakReference.clearAll();
    });
    
	test('clear', () => {
        const value = {"a": 1, "b": "test"};
        const ref = new WeakReference(value);
        ref.value = undefined;
		assert.strictEqual(ref.value, undefined);
        WeakReference.clearAll();
    });
    
	test('double clear', () => {
        const value = {"a": 1, "b": "test"};
        const ref = new WeakReference(value);
        ref.value = undefined;
        ref.clear();
		assert.strictEqual(ref.value, undefined);
        WeakReference.clearAll();
    });
    
	test('dispose', () => {
        let count = 0;
        const value = {"a": 1, "b": "test", "dispose": () => { 
            count += 1;
        }};
        let ref = new WeakReference(value);
        ref.dispose();

        assert.strictEqual(ref.value, undefined);
		assert.strictEqual(count, 1);
        assert.strictEqual(WeakReference.count, 0);
        WeakReference.clearAll();
    });
    
	test('create multiple', () => {
        const value = {"a": 2, "b": "test"};
        const ref = new WeakReference(value);
        const ref2 = new WeakReference(value);
        assert.strictEqual(WeakReference.count, 2);
        assert.strictEqual(ref.value, value);
        assert.strictEqual(ref2.value, value);
        WeakReference.clearAll();
    });
    
	test('create multiple2', () => {
        const value = {"a": 2, "b": "test"};
        const ref = new WeakReference(value);
        const ref2 = new WeakReference("something else");
        assert.strictEqual(WeakReference.count, 2);
        assert.strictEqual(ref.value, value);
        assert.strictEqual(ref2.value, "something else");
        WeakReference.clearAll();
    });
    
	test('create and delete multiple', () => {
        const value = {"a": 2, "b": "test"};
        const ref = new WeakReference(value);
        const ref2 = new WeakReference(value);
        assert.strictEqual(WeakReference.count, 2);
        assert.strictEqual(ref.value, value);
        assert.strictEqual(ref2.value, value);
        WeakReference.clearAll();
    });
    
	test('create and delete multiple2', () => {
        let refs = [];
        for (let i = 0; i < 32; i++) {
            refs.push(new WeakReference(i));
        }
        for (let i = 0; i < 32; i += 2) {
            refs[i].clear();
        }
        assert.strictEqual(WeakReference.count, 16);
        WeakReference.clearAll();
    });
    
	test('reuse after clear', () => {
        const value = {"a": 2, "b": "test"};
        const value2 = {"a": 4, "b": "test"};
        const ref = new WeakReference(value);
        ref.clear();
        ref.value = value2;
        assert.strictEqual(WeakReference.count, 1);
        assert.strictEqual(ref.value, value2);
        WeakReference.clearAll();
    });
    
	test('reuse after set undefined', () => {
        const value = {"a": 2, "b": "test"};
        const value2 = {"a": 4, "b": "test"};
        const ref = new WeakReference(value);
        ref.value = undefined;
        ref.value = value2;
        assert.strictEqual(WeakReference.count, 1);
        assert.strictEqual(ref.value, value2);
        WeakReference.clearAll();
    });
});