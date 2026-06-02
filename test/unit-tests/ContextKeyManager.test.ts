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
import { stub } from "sinon";
import * as vscode from "vscode";

import { ContextKeyManager } from "@src/ContextKeyManager";
import { FolderContext } from "@src/FolderContext";
import { SwiftPackage } from "@src/SwiftPackage";
import { LanguageClientManager } from "@src/sourcekit-lsp/LanguageClientManager";
import { Version } from "@src/utilities/version";

import { instance, mockObject } from "../MockUtils";

suite("ContextKeyManager Suite", () => {
    let manager: ContextKeyManager;
    let executeCommandStub: any;

    setup(() => {
        // Stub vscode.commands.executeCommand to prevent actual VS Code command execution
        executeCommandStub = stub(vscode.commands, "executeCommand");
        manager = new ContextKeyManager();
    });

    teardown(() => {
        executeCommandStub.restore();
    });

    suite("Property Setters", () => {
        test("all boolean properties set value and call setContext", () => {
            const properties: Array<{
                key: keyof ContextKeyManager;
                contextKey: string;
                value: boolean;
            }> = [
                { key: "isActivated", contextKey: "swift.isActivated", value: true },
                { key: "hasPackage", contextKey: "swift.hasPackage", value: true },
                {
                    key: "hasExecutableProduct",
                    contextKey: "swift.hasExecutableProduct",
                    value: true,
                },
                {
                    key: "packageHasDependencies",
                    contextKey: "swift.packageHasDependencies",
                    value: true,
                },
                {
                    key: "flatDependenciesList",
                    contextKey: "swift.flatDependenciesList",
                    value: true,
                },
                { key: "packageHasPlugins", contextKey: "swift.packageHasPlugins", value: true },
                { key: "fileIsSnippet", contextKey: "swift.fileIsSnippet", value: true },
                {
                    key: "lldbVSCodeAvailable",
                    contextKey: "swift.lldbVSCodeAvailable",
                    value: true,
                },
                {
                    key: "createNewProjectAvailable",
                    contextKey: "swift.createNewProjectAvailable",
                    value: true,
                },
                { key: "supportsReindexing", contextKey: "swift.supportsReindexing", value: true },
                {
                    key: "supportsDocumentationLivePreview",
                    contextKey: "swift.supportsDocumentationLivePreview",
                    value: true,
                },
                {
                    key: "supportsSwiftlyInstall",
                    contextKey: "swift.supportsSwiftlyInstall",
                    value: true,
                },
                {
                    key: "switchPlatformAvailable",
                    contextKey: "swift.switchPlatformAvailable",
                    value: true,
                },
            ];

            properties.forEach(({ key, contextKey, value }) => {
                executeCommandStub.resetHistory();
                (manager as any)[key] = value;

                expect(manager[key]).to.equal(value, `Property ${key} should be set to ${value}`);
                expect(
                    executeCommandStub.calledWith("setContext", contextKey, value),
                    `setContext should be called for ${contextKey}`
                ).to.be.true;
            });
        });

        test("currentTargetType sets value and calls setContext with 'none' for undefined", () => {
            manager.currentTargetType = undefined;

            expect(manager.currentTargetType).to.be.undefined;
            expect(executeCommandStub.calledWith("setContext", "swift.currentTargetType", "none"))
                .to.be.true;
        });

        test("currentTargetType sets value and calls setContext with actual value", () => {
            manager.currentTargetType = "executable";

            expect(manager.currentTargetType).to.equal("executable");
            expect(
                executeCommandStub.calledWith("setContext", "swift.currentTargetType", "executable")
            ).to.be.true;
        });
    });

    suite("updateForFolder", () => {
        test("resets package keys when folder is null", () => {
            manager.hasPackage = true;
            manager.hasExecutableProduct = true;
            manager.packageHasDependencies = true;

            manager.updateForFolder(null);

            expect(manager.hasPackage).to.be.false;
            expect(manager.hasExecutableProduct).to.be.false;
            expect(manager.packageHasDependencies).to.be.false;
        });

        test("updates package keys from folder context", async () => {
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        foundPackage: Promise.resolve(true),
                        executableProducts: Promise.resolve([
                            { name: "test", type: { executable: null }, targets: [] },
                        ]),
                        dependencies: Promise.resolve([{ identity: "dep1", dependencies: [] }]),
                    })
                ),
            });

            manager.updateForFolder(instance(mockFolder));

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(manager.hasPackage).to.be.true;
            expect(manager.hasExecutableProduct).to.be.true;
            expect(manager.packageHasDependencies).to.be.true;
        });

        test("handles no executable products", async () => {
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        foundPackage: Promise.resolve(true),
                        executableProducts: Promise.resolve([]),
                        dependencies: Promise.resolve([]),
                    })
                ),
            });

            manager.updateForFolder(instance(mockFolder));

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(manager.hasPackage).to.be.true;
            expect(manager.hasExecutableProduct).to.be.false;
            expect(manager.packageHasDependencies).to.be.false;
        });
    });

    suite("updateForFile", () => {
        test("resets currentTargetType when document is null", async () => {
            manager.currentTargetType = "executable";

            await manager.updateForFile(
                null,
                null,
                instance(
                    mockObject<{ get(folder: FolderContext): LanguageClientManager }>({
                        get: () => ({}) as LanguageClientManager,
                    })
                )
            );

            expect(manager.currentTargetType).to.be.undefined;
        });

        test("resets currentTargetType when folder is null", async () => {
            manager.currentTargetType = "executable";
            const mockUri = vscode.Uri.file("/test/file.swift");

            await manager.updateForFile(
                mockUri,
                null,
                instance(
                    mockObject<{ get(folder: FolderContext): LanguageClientManager }>({
                        get: () => ({}) as LanguageClientManager,
                    })
                )
            );

            expect(manager.currentTargetType).to.be.undefined;
        });

        test("updates currentTargetType from folder context", async () => {
            const mockUri = vscode.Uri.file("/test/file.swift");
            const mockSwiftPackage = mockObject<SwiftPackage>({
                getTarget: async () => ({
                    type: "executable",
                    name: "test",
                    c99name: "test",
                    path: "/test",
                    sources: [],
                }),
            });
            mockSwiftPackage.getTarget.resolves({
                type: "executable",
                name: "test",
                c99name: "test",
                path: "/test",
                sources: [],
            });
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(mockSwiftPackage),
                swiftVersion: new Version(5, 7, 0),
                folder: mockUri,
            });
            const mockLanguageClient = mockObject<LanguageClientManager>({
                useLanguageClient: async <Return>(_fn: any): Promise<Return> => {
                    return undefined as Return;
                },
            });
            const mockLanguageClientManager = mockObject<{
                get(folder: FolderContext): LanguageClientManager;
            }>({
                get: () => instance(mockLanguageClient),
            });
            mockLanguageClientManager.get.returns(instance(mockLanguageClient));

            await manager.updateForFile(
                mockUri,
                instance(mockFolder),
                instance(mockLanguageClientManager)
            );

            expect(manager.currentTargetType).to.equal("executable");
        });

        test("updates SourceKit-LSP capabilities", async () => {
            const mockUri = vscode.Uri.file("/test/file.swift");
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        getTarget: async () => undefined,
                    })
                ),
                swiftVersion: new Version(5, 7, 0),
                folder: mockUri,
            });
            const mockLanguageClient = {
                useLanguageClient: async (fn: any) => {
                    await fn({
                        initializeResult: {
                            capabilities: {
                                experimental: {
                                    "workspace/triggerReindex": {},
                                    "textDocument/doccDocumentation": {},
                                },
                            },
                        },
                    });
                },
            };
            const mockLanguageClientManager = {
                get: () => mockLanguageClient,
            };

            await manager.updateForFile(
                mockUri,
                instance(mockFolder),
                instance(mockLanguageClientManager)
            );

            expect(manager.supportsReindexing).to.be.true;
            expect(manager.supportsDocumentationLivePreview).to.be.true;
        });

        test("resets SourceKit-LSP capabilities when not available", async () => {
            manager.supportsReindexing = true;
            manager.supportsDocumentationLivePreview = true;

            const mockUri = vscode.Uri.file("/test/file.swift");
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        getTarget: async () => undefined,
                    })
                ),
                swiftVersion: new Version(5, 7, 0),
                folder: mockUri,
            });
            const mockLanguageClient = {
                useLanguageClient: async (fn: any) => {
                    await fn({
                        initializeResult: {
                            capabilities: {},
                        },
                    });
                },
            };
            const mockLanguageClientManager = {
                get: () => mockLanguageClient,
            };

            await manager.updateForFile(
                mockUri,
                instance(mockFolder),
                instance(mockLanguageClientManager)
            );

            expect(manager.supportsReindexing).to.be.false;
            expect(manager.supportsDocumentationLivePreview).to.be.false;
        });

        test("sets fileIsSnippet when file is in Snippets folder", async () => {
            const mockUri = vscode.Uri.file("/test/Snippets/MySnippet.swift");
            const mockFolderUri = vscode.Uri.file("/test");
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        getTarget: async () => undefined,
                    })
                ),
                swiftVersion: new Version(5, 7, 0),
                folder: mockFolderUri,
            });
            const mockLanguageClient = mockObject<LanguageClientManager>({
                useLanguageClient: async <Return>(_fn: any): Promise<Return> => {
                    return undefined as Return;
                },
            });
            const mockLanguageClientManager = mockObject<{
                get(folder: FolderContext): LanguageClientManager;
            }>({
                get: () => instance(mockLanguageClient),
            });
            mockLanguageClientManager.get.returns(instance(mockLanguageClient));

            await manager.updateForFile(
                mockUri,
                instance(mockFolder),
                instance(mockLanguageClientManager)
            );

            expect(manager.fileIsSnippet).to.be.true;
        });

        test("does not set fileIsSnippet for Swift version < 5.7", async () => {
            const mockUri = vscode.Uri.file("/test/Snippets/MySnippet.swift");
            const mockFolderUri = vscode.Uri.file("/test");
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        getTarget: async () => undefined,
                    })
                ),
                swiftVersion: new Version(5, 6, 0),
                folder: mockFolderUri,
            });
            const mockLanguageClient = {
                useLanguageClient: async (_fn: any) => {},
            };
            const mockLanguageClientManager = {
                get: () => mockLanguageClient,
            };

            await manager.updateForFile(
                mockUri,
                instance(mockFolder),
                instance(mockLanguageClientManager)
            );

            expect(manager.fileIsSnippet).to.be.false;
        });

        test("clears fileIsSnippet when file is not in Snippets folder", async () => {
            manager.fileIsSnippet = true;

            const mockUri = vscode.Uri.file("/test/Sources/MyFile.swift");
            const mockFolderUri = vscode.Uri.file("/test");
            const mockFolder = mockObject<FolderContext>({
                swiftPackage: instance(
                    mockObject<SwiftPackage>({
                        getTarget: async () => undefined,
                    })
                ),
                swiftVersion: new Version(5, 7, 0),
                folder: mockFolderUri,
            });
            const mockLanguageClient = mockObject<LanguageClientManager>({
                useLanguageClient: async <Return>(_fn: any): Promise<Return> => {
                    return undefined as Return;
                },
            });
            const mockLanguageClientManager = mockObject<{
                get(folder: FolderContext): LanguageClientManager;
            }>({
                get: () => instance(mockLanguageClient),
            });
            mockLanguageClientManager.get.returns(instance(mockLanguageClient));

            await manager.updateForFile(
                mockUri,
                instance(mockFolder),
                instance(mockLanguageClientManager)
            );

            expect(manager.fileIsSnippet).to.be.false;
        });
    });

    suite("updateForPlugins", () => {
        test("sets packageHasPlugins to true when any folder has plugins", () => {
            const mockFolders = [
                mockObject<FolderContext>({
                    swiftPackage: instance(mockObject<SwiftPackage>({ plugins: [] })),
                }),
                mockObject<FolderContext>({
                    swiftPackage: instance(
                        mockObject<SwiftPackage>({
                            plugins: [{ name: "test-plugin", command: "cmd", package: "pkg" }],
                        })
                    ),
                }),
            ];

            manager.updateForPlugins([instance(mockFolders[0]), instance(mockFolders[1])]);

            expect(manager.packageHasPlugins).to.be.true;
        });

        test("sets packageHasPlugins to false when no folders have plugins", () => {
            manager.packageHasPlugins = true;

            const mockFolders = [
                mockObject<FolderContext>({
                    swiftPackage: instance(mockObject<SwiftPackage>({ plugins: [] })),
                }),
                mockObject<FolderContext>({
                    swiftPackage: instance(mockObject<SwiftPackage>({ plugins: [] })),
                }),
            ];

            manager.updateForPlugins([instance(mockFolders[0]), instance(mockFolders[1])]);

            expect(manager.packageHasPlugins).to.be.false;
        });

        test("sets packageHasPlugins to false for empty folder array", () => {
            manager.packageHasPlugins = true;

            manager.updateForPlugins([]);

            expect(manager.packageHasPlugins).to.be.false;
        });
    });

    suite("updateKeysBasedOnActiveVersion", () => {
        test("enables createNewProjectAvailable for Swift 5.8.0+", () => {
            manager.updateKeysBasedOnActiveVersion(new Version(5, 8, 0));

            expect(manager.createNewProjectAvailable).to.be.true;
        });

        test("disables createNewProjectAvailable for Swift < 5.8.0", () => {
            manager.createNewProjectAvailable = true;

            manager.updateKeysBasedOnActiveVersion(new Version(5, 7, 0));

            expect(manager.createNewProjectAvailable).to.be.false;
        });

        test("enables switchPlatformAvailable on macOS for Swift 6.1.0+", () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "darwin" });

            manager.updateKeysBasedOnActiveVersion(new Version(6, 1, 0));

            expect(manager.switchPlatformAvailable).to.be.true;

            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        test("disables switchPlatformAvailable on non-macOS platforms", () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "linux" });

            manager.updateKeysBasedOnActiveVersion(new Version(6, 1, 0));

            expect(manager.switchPlatformAvailable).to.be.false;

            Object.defineProperty(process, "platform", { value: originalPlatform });
        });

        test("disables switchPlatformAvailable on macOS for Swift < 6.1.0", () => {
            const originalPlatform = process.platform;
            Object.defineProperty(process, "platform", { value: "darwin" });
            manager.switchPlatformAvailable = true;

            manager.updateKeysBasedOnActiveVersion(new Version(6, 0, 0));

            expect(manager.switchPlatformAvailable).to.be.false;

            Object.defineProperty(process, "platform", { value: originalPlatform });
        });
    });
});
