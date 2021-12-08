import * as assert from 'assert';
import { getRepositoryName } from '../../utilities';

suite('Utilities Test Suite', () => {

	test('getRepositoryName', () => {
		// Regular case.
		assert.strictEqual(
			getRepositoryName('https://github.com/swift-server/vscode-swift.git'),
			'vscode-swift'
		);
		// URL does not end in .git.
		assert.strictEqual(
			getRepositoryName('https://github.com/swift-server/vscode-swift'),
			'vscode-swift'
		);
		// URL contains a trailing slash.
		assert.strictEqual(
			getRepositoryName('https://github.com/swift-server/vscode-swift.git/'),
			'vscode-swift'
		);
		// Name contains a dot.
		assert.strictEqual(
			getRepositoryName('https://github.com/swift-server/vscode.swift.git'),
			'vscode.swift'
		);
		// Name contains .git.
		assert.strictEqual(
			getRepositoryName('https://github.com/swift-server/vscode.git.git'),
			'vscode.git'
		);
	});
});
