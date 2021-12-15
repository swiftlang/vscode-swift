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

'use strict';
import * as vscode from 'vscode';
import * as langclient from 'vscode-languageclient/node';
import { getSwiftExecutable } from '../utilities';
import { activateInlayHints } from './inlayHints';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('sourcekit-lsp');

    const sourcekit: langclient.Executable = {
        command: getSwiftExecutable('sourcekit-lsp'),
        args: config.get<string[]>('serverArguments', [])
    };

    const toolchain = config.get<string>('toolchainPath', '');
    if (toolchain) {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        sourcekit.options = { env: { ...process.env, SOURCEKIT_TOOLCHAIN_PATH: toolchain } };
    }

    const serverOptions: langclient.ServerOptions = sourcekit;

    const clientOptions: langclient.LanguageClientOptions = {
        documentSelector: [
            'swift',
            'cpp',
            'c',
            'objective-c',
            'objective-cpp'
        ],
        synchronize: undefined,
        revealOutputChannelOn: langclient.RevealOutputChannelOn.Never
    };

    const client = new langclient.LanguageClient('sourcekit-lsp', 'SourceKit Language Server', serverOptions, clientOptions);

    context.subscriptions.push(client.start());

    console.log('SourceKit-LSP is now active!');

    await client.onReady();
    activateInlayHints(context, client);
}
