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
import { loadTestResourceAsString } from '../fixtures';

suite('Fixtures Test Suite', () => {
	
	test('loadTestResourceAsString', async () => {
		const contents = await loadTestResourceAsString('hello.txt');
		assert.strictEqual(contents, 'Hello, world!');
	});
});
