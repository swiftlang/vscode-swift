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
import { expect } from "chai";
import * as path from "path";
import * as sinon from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import {
    determineSchemaURL,
    hasLocalSchema,
    localSchemaPath,
} from "@src/commands/generateSourcekitConfiguration";
import configuration from "@src/configuration";
import { SwiftToolchain } from "@src/toolchain/toolchain";
import * as filesystemModule from "@src/utilities/filesystem";
import { Version } from "@src/utilities/version";

import { mockGlobalModule } from "../../MockUtils";

suite("generateSourcekitConfiguration - Schema Detection", () => {
    let sandbox: sinon.SinonSandbox;
    let mockFolderContext: FolderContext;
    let fileExistsStub: sinon.SinonStub;
    const mockedConfiguration = mockGlobalModule(configuration);

    function createMockFolderContext(toolchainPath: string, version: Version): FolderContext {
        const mockToolchain = {
            toolchainPath,
            swiftVersion: version,
        } as SwiftToolchain;

        return {
            folder: vscode.Uri.file("/test/workspace"),
            swiftVersion: version,
            toolchain: mockToolchain,
            name: "TestFolder",
        } as FolderContext;
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        fileExistsStub = sandbox.stub(filesystemModule, "fileExists");
        mockedConfiguration.lspConfigurationBranch = "";
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("localSchemaPath()", () => {
        test("returns correct path for toolchain", () => {
            mockFolderContext = createMockFolderContext("/path/to/toolchain", new Version(6, 3, 0));

            const result = localSchemaPath(mockFolderContext);

            expect(result).to.equal(
                path.normalize("/path/to/toolchain/share/sourcekit-lsp/config.schema.json")
            );
        });

        test("returns correct path for toolchain with trailing slash", () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/path/to/toolchain/"),
                new Version(6, 3, 0)
            );

            const result = localSchemaPath(mockFolderContext);

            expect(result).to.equal(
                path.normalize("/path/to/toolchain/share/sourcekit-lsp/config.schema.json")
            );
        });

        test("returns correct path for nested toolchain directory", () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/usr/local/swift-6.3.0"),
                new Version(6, 3, 0)
            );

            const result = localSchemaPath(mockFolderContext);

            expect(result).to.equal(
                path.normalize("/usr/local/swift-6.3.0/share/sourcekit-lsp/config.schema.json")
            );
        });
    });

    suite("hasLocalSchema()", () => {
        test("returns true when schema file exists", async () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/path/to/toolchain"),
                new Version(6, 3, 0)
            );
            fileExistsStub.resolves(true);

            const result = await hasLocalSchema(mockFolderContext);

            expect(result).to.be.true;
            expect(fileExistsStub).to.have.been.calledWith(
                path.normalize("/path/to/toolchain/share/sourcekit-lsp/config.schema.json")
            );
        });

        test("returns false when schema file doesn't exist", async () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/path/to/toolchain"),
                new Version(6, 1, 0)
            );
            fileExistsStub.resolves(false);

            const result = await hasLocalSchema(mockFolderContext);

            expect(result).to.be.false;
        });

        test("returns false on filesystem errors", async () => {
            mockFolderContext = createMockFolderContext("/path/to/toolchain", new Version(6, 3, 0));
            fileExistsStub.resolves(false);

            const result = await hasLocalSchema(mockFolderContext);

            expect(result).to.be.false;
        });
    });

    suite("determineSchemaURL()", () => {
        test("returns file:// URL when local schema exists", async () => {
            mockFolderContext = createMockFolderContext("/path/to/toolchain", new Version(6, 3, 0));
            fileExistsStub.resolves(true);

            const result = await determineSchemaURL(mockFolderContext);

            expect(result).to.match(/^file:\/\//);
            expect(result).to.include("config.schema.json");
            expect(result).to.include("sourcekit-lsp");
        });

        test("returns https:// URL when local schema doesn't exist", async () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/path/to/toolchain"),
                new Version(6, 1, 0)
            );
            fileExistsStub.resolves(false);

            const result = await determineSchemaURL(mockFolderContext);

            expect(result).to.match(/^https:\/\//);
            expect(result).to.include("githubusercontent.com");
            expect(result).to.include("sourcekit-lsp");
        });

        test("local schema path includes share/sourcekit-lsp/config.schema.json", async () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/usr/local/swift-6.3"),
                new Version(6, 3, 0)
            );
            fileExistsStub.resolves(true);

            const result = await determineSchemaURL(mockFolderContext);

            expect(result).to.include("/usr/local/swift-6.3");
            expect(result).to.include("share/sourcekit-lsp/config.schema.json");
        });

        test("remote URL uses correct branch for release version", async () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/path/to/toolchain"),
                new Version(6, 2, 0)
            );
            fileExistsStub.resolves(false);

            const fetchStub = sandbox.stub(globalThis, "fetch");
            fetchStub.resolves({
                ok: true,
                status: 200,
            } as Response);

            const result = await determineSchemaURL(mockFolderContext);

            expect(result).to.include("release/6.2");
        });

        test("remote URL uses main for dev version", async () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/path/to/toolchain"),
                new Version(6, 3, 0, true)
            );
            fileExistsStub.resolves(false);

            const fetchStub = sandbox.stub(globalThis, "fetch");
            fetchStub.resolves({
                ok: true,
                status: 200,
            } as Response);

            const result = await determineSchemaURL(mockFolderContext);

            expect(result).to.include("main");
        });

        test("falls back to main when branch doesn't exist", async () => {
            mockFolderContext = createMockFolderContext(
                path.normalize("/path/to/toolchain"),
                new Version(5, 9, 0)
            );
            fileExistsStub.resolves(false);

            const fetchStub = sandbox.stub(globalThis, "fetch");
            fetchStub.onFirstCall().resolves({
                ok: false,
                status: 404,
            } as Response);
            fetchStub.onSecondCall().resolves({
                ok: true,
                status: 200,
            } as Response);

            const result = await determineSchemaURL(mockFolderContext);

            expect(result).to.include("main");
        });
    });
});
