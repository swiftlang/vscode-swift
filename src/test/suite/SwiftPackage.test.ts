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
import { SwiftPackage } from '../../SwiftPackage';

suite('SwiftPackage Test Suite', () => {
	test('No package', async () => {
        let spmPackage = await SwiftPackage.create('assets/test/empty-folder');
        assert.strictEqual(spmPackage.targets.length, 0);
    });

	test('Invalid package', async () => {
        let spmPackage = await SwiftPackage.create('assets/test/invalid-package');
        assert.strictEqual(spmPackage.targets.length, 0);
    });

	test('Working package', async () => {
        let spmPackage = await SwiftPackage.create('assets/test/package1');
        //assert.strictEqual(spmPackage.isValid, true)
        assert.strictEqual(spmPackage.products.length, 1);
        assert.strictEqual(spmPackage.products[0].name, "package1");
        assert.strictEqual(spmPackage.dependencies.length, 1);
        assert.strictEqual(spmPackage.targets.length, 2);
    });
});
