//import { parse } from 'lcov-parse';
import * as fs from "fs";
import configuration from "../configuration";
import { FolderContext } from "../FolderContext";
import { buildDirectoryFromWorkspacePath, execFileStreamOutput } from "../utilities/utilities";

export async function generateLcovFile(folderContext: FolderContext) {
    const llvmCov = folderContext.workspaceContext.toolchain.getToolchainExecutable("llvm-cov");
    const packageName = folderContext.swiftPackage.name;
    const buildDirectory = buildDirectoryFromWorkspacePath(folderContext.folder.fsPath, true);
    const lcovFileName = `${buildDirectory}/debug/codecov/lcov.info`;

    // Use WriteStream to log results
    const lcovStream = fs.createWriteStream(lcovFileName);

    try {
        let xctestFile = `${buildDirectory}/debug/${packageName}PackageTests.xctest`;
        if (process.platform === "darwin") {
            xctestFile += `/Contents/MacOs/${packageName}PackageTests`;
        }
        await execFileStreamOutput(
            llvmCov,
            [
                "export",
                "-format",
                "lcov",
                xctestFile,
                "-ignore-filename-regex=Tests|.build|Snippets|Plugins",
                `-instr-profile=${buildDirectory}/debug/codecov/default.profdata`,
            ],
            lcovStream,
            lcovStream,
            null,
            {
                env: { ...process.env, ...configuration.swiftEnvironmentVariables },
            },
            folderContext
        );
    } catch (error) {
        lcovStream.end();
        throw error;
    }
}
