import * as vscode from "vscode";
import { FolderContext } from "../FolderContext";
import { LcovResults } from "./LcovResults";

export class TestCoverage {
    private lcovResults: LcovResults;
    private coverageDetails = new Map<vscode.Uri, vscode.FileCoverageDetail[]>();

    constructor(folderContext: FolderContext) {
        this.lcovResults = new LcovResults(folderContext);
    }

    /**
     * Captures the coverage data after an individual test binary has been run.
     * After the test run completes then the coverage is merged.
     */
    public async captureCoverage() {
        await this.lcovResults.generate();
    }

    public loadDetailedCoverage(uri: vscode.Uri) {
        return this.coverageDetails.get(uri) || [];
    }

    /**
     * Once all test binaries have been run compute the coverage information and
     * associate it with the test run.
     */
    async computeCoverage(testRun: vscode.TestRun) {
        const lcovFiles = await this.lcovResults.computeCoverage();
        if (lcovFiles.length > 0) {
            for (const sourceFileCoverage of lcovFiles) {
                const uri = vscode.Uri.file(sourceFileCoverage.file);
                const detailedCoverage: vscode.FileCoverageDetail[] = [];
                for (const lineCoverage of sourceFileCoverage.lines.details) {
                    const statementCoverage = new vscode.StatementCoverage(
                        lineCoverage.hit,
                        new vscode.Position(lineCoverage.line - 1, 0)
                    );
                    detailedCoverage.push(statementCoverage);
                }

                const coverage = vscode.FileCoverage.fromDetails(uri, detailedCoverage);
                testRun.addCoverage(coverage);
                this.coverageDetails.set(uri, detailedCoverage);
            }
        }
    }
}
