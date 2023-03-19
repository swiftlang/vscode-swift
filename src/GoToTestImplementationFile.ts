import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export type RelatedFile = ImplFile | TestFile;

export type ImplFile = { kind: "impl"; path: string };
export type TestFile = { kind: "test"; path: string; implPackageName: string };

export async function goToRelatedFile(document: vscode.TextDocument | undefined) {
    if (!isSwiftDocument(document)) {
        return;
    }
    const file = getImplOrTestFileFromPath(document?.uri.fsPath);
    if (!file) {
        return;
    }

    const relatedFile = getRelatedFile(file);
    if (!relatedFile) {
        return;
    }

    const exists =
        fs.existsSync(relatedFile.path) || (await promptToCreateRelatedFile(relatedFile));
    if (!exists) {
        return;
    }

    openRelatedFile(relatedFile);
}

function getImplOrTestFileFromPath(filePath: string | undefined): RelatedFile | undefined {
    if (!filePath) {
        return undefined;
    }
    if (!exists(filePath)) {
        return undefined;
    }
    return isTestFile(filePath)
        ? { kind: "test", path: filePath, implPackageName: "" }
        : { kind: "impl", path: filePath };
}

function getRelatedFile(relatedFile: RelatedFile): RelatedFile | undefined {
    switch (relatedFile.kind) {
        case "impl":
            return getTestFile(relatedFile);
        case "test":
            return getImplFile(relatedFile);
    }
}

function getTestFile(implFile: ImplFile): TestFile | undefined {
    const [pathSegments, index] = pathSegmentsAndIndexReplaced(implFile.path, "Sources", "Tests");
    if (index === undefined || index + 1 >= pathSegments.length) {
        return undefined;
    }

    // Append "Tests" suffix to package name
    pathSegments[index + 1] = pathSegments[index + 1] + "Tests";

    // Append "Tests" suffix to file basename
    pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(
        /\.swift$/,
        "Tests.swift"
    );

    return {
        kind: "test",
        path: pathSegments.join(path.sep),
        implPackageName: pathSegments[index + 1].replace(/Tests/, ""),
    };
}

function getImplFile(testFile: TestFile): ImplFile | undefined {
    const [pathSegments, index] = pathSegmentsAndIndexReplaced(testFile.path, "Tests", "Sources");
    if (index === undefined || index + 1 >= pathSegments.length) {
        return undefined;
    }

    // Remove "Tests" suffix from package name
    pathSegments[index + 1] = pathSegments[index + 1].replace(/Tests$/, "");

    // Remove "Tests" suffix from file basename
    pathSegments[pathSegments.length - 1] = pathSegments[pathSegments.length - 1].replace(
        /Tests.swift$/,
        ".swift"
    );

    return {
        kind: "impl",
        path: pathSegments.join(path.sep),
    };
}

/**
 * This function prompts the user to create a file related to the given
 * RelatedFile. If the user chooses to create the file, it is created and
 * added to the project. Returns true if the file was created, false otherwise.
 */
export async function promptToCreateRelatedFile(file: RelatedFile): Promise<boolean> {
    const result = await vscode.window.showInformationMessage(
        `Would you like to create the ${file.kind} file at ${file.path}?`,
        "Yes",
        "No"
    );

    if (result === "No") {
        return false;
    }

    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, dataOfRelatedFile(file));

    return true;
}

function isSwiftDocument(document: vscode.TextDocument | undefined): boolean {
    return document?.languageId === "swift" ?? false;
}

function exists(filePath: string): boolean {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

/**
 * This function checks if a file is a test file, and returns true if it is.
 */
function isTestFile(filePath: string): boolean {
    return isInsideFolderNamed(filePath, "Tests") && filePath.endsWith("Tests.swift");
}

/**
 * This function returns true if the provided file path contains a folder with the provided name.
 */
function isInsideFolderNamed(filePath: string, folderName: string): boolean {
    const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!workspace) {
        return false;
    }
    const relativePath = path.relative(workspace.uri.fsPath.toLowerCase(), filePath.toLowerCase());
    const segments = relativePath.split(path.sep);
    return segments.includes(folderName.toLowerCase());
}

/**
 * This function replaces the last occurrence of the provided "from" string
 * with the provided "to" string in the provided file path. It returns the
 * new path segments and the index of the replaced segment.
 * If the "from" string is not found in the file path, it returns the original
 * path segments and undefined as the index.
 * This function is used to replace the "Sources" or "Tests" folder in a file path.
 */
function pathSegmentsAndIndexReplaced(
    filePath: string,
    from: string,
    to: string
): [string[], number | undefined] {
    const pathSegments = filePath.split(path.sep);
    const index = pathSegments.lastIndexOf(from);
    if (index === -1) {
        return [pathSegments, undefined];
    } else {
        pathSegments[index] = to;
        return [pathSegments, index];
    }
}

/**
 * This function opens the given RelatedFile in a new editor.
 */
export async function openRelatedFile(file: RelatedFile) {
    const document = await vscode.workspace.openTextDocument(file.path);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 0);
}

/**
 * This function returns the default data for a given AssociatedFile.
 * If the file is a test file, it returns a default test file template.
 * If the file is an implementation file, it returns a default implementation file template.
 * This function is used when creating a new file.
 */
function dataOfRelatedFile(file: RelatedFile): string {
    switch (file.kind) {
        case "test":
            return defaultTestFileTemplate(file);
        case "impl":
            return defaultImplementationFileTemplate();
    }
}

function defaultTestFileTemplate(testFile: TestFile) {
    const basename = path.basename(testFile.path, ".swift");
    return `import XCTest
@testable import ${testFile.implPackageName}

final class ${basename}: XCTestCase {
}
`;
}

function defaultImplementationFileTemplate() {
    return `import Foundation`;
}
