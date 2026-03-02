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
import { stub } from "sinon";
import * as vscode from "vscode";

import { FolderContext } from "@src/FolderContext";
import { WorkspaceContext } from "@src/WorkspaceContext";
import { createDocumentationCatalog } from "@src/commands/createDocumentationCatalog";
import * as filesystem from "@src/utilities/filesystem";

import { instance, mockGlobalModule, mockGlobalObject, mockObject } from "../../MockUtils";

suite("createDocumentationCatalog Command Test Suite", () => {
    const windowMock = mockGlobalObject(vscode, "window");
    const filesystemMock = mockGlobalModule(filesystem);

    const rootPath = "/tmp/test-package";
    const targetName = "MyLib";
    const targetPath = "Sources/MyLib";
    const targetBasePath = path.join(rootPath, targetPath);

    function createMockFolderContext(
        overrides: {
            getTargets?: () => Promise<{ name: string; path: string; type: string }[]>;
        } = {}
    ): FolderContext {
        const getTargets =
            overrides.getTargets ??
            (() => Promise.resolve([{ name: targetName, path: targetPath, type: "library" }]));
        const swiftPackage = {
            getTargets: stub().callsFake(getTargets),
        };
        return instance(
            mockObject<FolderContext>({
                folder: vscode.Uri.file(rootPath),
                swiftPackage: swiftPackage as unknown as FolderContext["swiftPackage"],
            })
        ) as unknown as FolderContext;
    }

    function createMockWorkspaceContext(folders: FolderContext[]): WorkspaceContext {
        return instance(
            mockObject<WorkspaceContext>({
                folders,
            })
        ) as unknown as WorkspaceContext;
    }

    setup(() => {
        windowMock.showQuickPick.resolves(undefined);
        windowMock.showErrorMessage.resolves(undefined);
        windowMock.showInformationMessage.resolves(undefined);
        windowMock.showWarningMessage.resolves(undefined);
        filesystemMock.folderExists.resolves(true);
        filesystemMock.provisionDoccCatalog.resolves(true);
    });

    test("shows error when no workspace folders", async () => {
        const ctx = createMockWorkspaceContext([]);

        await createDocumentationCatalog(ctx);

        expect(windowMock.showErrorMessage).to.have.been.calledOnceWith(
            "Creating a documentation catalog requires an open workspace folder."
        );
        expect(windowMock.showQuickPick).to.not.have.been.called;
        expect(filesystemMock.provisionDoccCatalog).to.not.have.been.called;
    });

    test("shows error when package has no targets", async () => {
        const folder = createMockFolderContext({
            getTargets: () => Promise.resolve([]),
        });
        const ctx = createMockWorkspaceContext([folder]);
        filesystemMock.folderExists.resolves(true);

        await createDocumentationCatalog(ctx);

        expect(windowMock.showErrorMessage).to.have.been.calledOnceWith(
            "No Swift package targets found. Open a folder that contains a Package.swift."
        );
        expect(filesystemMock.provisionDoccCatalog).to.not.have.been.called;
    });

    test("does nothing when user cancels QuickPick", async () => {
        const folder = createMockFolderContext();
        const ctx = createMockWorkspaceContext([folder]);
        windowMock.showQuickPick.resolves(undefined);

        await createDocumentationCatalog(ctx);

        expect(windowMock.showQuickPick).to.have.been.calledOnce;
        expect(filesystemMock.provisionDoccCatalog).to.not.have.been.called;
        expect(windowMock.showInformationMessage).to.not.have.been.called;
    });

    test("creates catalog for selected target and shows success message", async () => {
        const folder = createMockFolderContext();
        const ctx = createMockWorkspaceContext([folder]);
        (windowMock.showQuickPick as import("sinon").SinonStub<any[], any>).callsFake(
            (items: any) =>
                Promise.resolve(items).then((resolved: readonly vscode.QuickPickItem[]) =>
                    resolved && resolved.length > 0 ? [resolved[0]] : undefined
                )
        );

        await createDocumentationCatalog(ctx);

        expect(windowMock.showQuickPick).to.have.been.calledOnce;
        expect(filesystemMock.provisionDoccCatalog).to.have.been.calledOnceWith(
            targetBasePath,
            targetName
        );
        expect(windowMock.showInformationMessage).to.have.been.calledOnceWith(
            `Created DocC catalog(s): ${targetName}.docc`
        );
    });

    test("shows warning when catalog already exists for selected target", async () => {
        const folder = createMockFolderContext();
        const ctx = createMockWorkspaceContext([folder]);
        filesystemMock.provisionDoccCatalog.resolves(false);
        (windowMock.showQuickPick as import("sinon").SinonStub<any[], any>).callsFake(
            (items: any) =>
                Promise.resolve(items).then((resolved: readonly vscode.QuickPickItem[]) =>
                    resolved && resolved.length > 0 ? [resolved[0]] : undefined
                )
        );

        await createDocumentationCatalog(ctx);

        expect(filesystemMock.provisionDoccCatalog).to.have.been.calledOnceWith(
            targetBasePath,
            targetName
        );
        expect(windowMock.showWarningMessage).to.have.been.calledOnceWith(
            `Catalog(s) already exist and were skipped: ${targetName}.docc`
        );
        expect(windowMock.showInformationMessage).to.not.have.been.called;
    });

    test("creates catalogs for multiple selected targets", async () => {
        const getTargets = () =>
            Promise.resolve([
                { name: "LibA", path: "Sources/LibA", type: "library" },
                { name: "LibB", path: "Sources/LibB", type: "library" },
            ]);
        const folder = createMockFolderContext({ getTargets });
        const ctx = createMockWorkspaceContext([folder]);
        filesystemMock.provisionDoccCatalog
            .onFirstCall()
            .resolves(true)
            .onSecondCall()
            .resolves(true);
        (windowMock.showQuickPick as import("sinon").SinonStub<any[], any>).callsFake(
            (items: any) =>
                Promise.resolve(items).then((resolved: readonly vscode.QuickPickItem[]) =>
                    resolved && resolved.length > 0 ? [...resolved] : undefined
                )
        );

        await createDocumentationCatalog(ctx);

        expect(filesystemMock.provisionDoccCatalog).to.have.been.calledTwice;
        expect(filesystemMock.provisionDoccCatalog).to.have.been.calledWith(
            path.join(rootPath, "Sources/LibA"),
            "LibA"
        );
        expect(filesystemMock.provisionDoccCatalog).to.have.been.calledWith(
            path.join(rootPath, "Sources/LibB"),
            "LibB"
        );
        expect(windowMock.showInformationMessage).to.have.been.calledOnceWith(
            "Created DocC catalog(s): LibA.docc, LibB.docc"
        );
    });

    test("uses folderContext when provided", async () => {
        const folder = createMockFolderContext();
        const ctx = createMockWorkspaceContext([folder]);
        (windowMock.showQuickPick as import("sinon").SinonStub<any[], any>).callsFake(
            (items: any) =>
                Promise.resolve(items).then((resolved: readonly vscode.QuickPickItem[]) =>
                    resolved && resolved.length > 0 ? [resolved[0]] : undefined
                )
        );

        await createDocumentationCatalog(ctx, folder);

        expect(windowMock.showQuickPick).to.have.been.calledOnce;
        expect(filesystemMock.provisionDoccCatalog).to.have.been.calledOnceWith(
            targetBasePath,
            targetName
        );
    });
});
