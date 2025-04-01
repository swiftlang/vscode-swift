import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SwiftTutorial {
    private static instance: SwiftTutorial;
    private context: vscode.ExtensionContext;
    private tutorialState: { [key: string]: boolean };

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.tutorialState = this.context.workspaceState.get('swiftTutorialState', {});
    }

    public static getInstance(context: vscode.ExtensionContext): SwiftTutorial {
        if (!SwiftTutorial.instance) {
            SwiftTutorial.instance = new SwiftTutorial(context);
        }
        return SwiftTutorial.instance;
    }

    public async showTutorial(): Promise<void> {
        const tutorial = {
            id: 'swift-tutorial',
            title: 'Getting Started with Swift in VS Code',
            description: 'Learn how to use Swift in Visual Studio Code',
            steps: [
                {
                    id: 'toolchain-setup',
                    title: 'Install Swift Toolchain',
                    description: 'First, you need to install the Swift toolchain on your system.',
                    media: {
                        image: 'assets/tutorial/toolchain-setup.png',
                        alt: 'Swift toolchain installation'
                    },
                    completionEvents: ['onCommand:swift.selectToolchain']
                },
                {
                    id: 'create-project',
                    title: 'Create Your First Swift Project',
                    description: 'Create a new Swift package using Swift Package Manager.',
                    media: {
                        image: 'assets/tutorial/create-project.png',
                        alt: 'Creating a new Swift project'
                    },
                    completionEvents: ['onCommand:swift.createNewProject']
                },
                {
                    id: 'build-run',
                    title: 'Build and Run',
                    description: 'Learn how to build and run your Swift project.',
                    media: {
                        image: 'assets/tutorial/build-run.png',
                        alt: 'Building and running a Swift project'
                    },
                    completionEvents: ['onCommand:swift.run']
                },
                {
                    id: 'debugging',
                    title: 'Debugging',
                    description: 'Set breakpoints and debug your Swift code.',
                    media: {
                        image: 'assets/tutorial/debugging.png',
                        alt: 'Debugging Swift code'
                    },
                    completionEvents: ['onCommand:swift.debug']
                },
                {
                    id: 'testing',
                    title: 'Testing',
                    description: 'Write and run tests for your Swift code.',
                    media: {
                        image: 'assets/tutorial/testing.png',
                        alt: 'Testing Swift code'
                    },
                    completionEvents: ['onCommand:swift.run']
                },
                {
                    id: 'package-manager',
                    title: 'Swift Package Manager',
                    description: 'Learn how to manage dependencies with Swift Package Manager.',
                    media: {
                        image: 'assets/tutorial/package-manager.png',
                        alt: 'Using Swift Package Manager'
                    },
                    completionEvents: ['onCommand:swift.updateDependencies']
                }
            ]
        };

        await vscode.window.showInformationMessage('Starting Swift Tutorial...');
        await vscode.commands.executeCommand('workbench.action.walkthroughs.open', tutorial.id);
    }

    public async checkToolchain(): Promise<boolean> {
        try {
            const result = await vscode.commands.executeCommand('swift.selectToolchain');
            return result !== undefined;
        } catch (error) {
            return false;
        }
    }

    public async createSampleProject(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const projectPath = path.join(workspaceFolder.uri.fsPath, 'SwiftTutorial');
        if (!fs.existsSync(projectPath)) {
            fs.mkdirSync(projectPath);
        }

        // Create Package.swift
        const packageContent = `// swift-tools-version:5.5
import PackageDescription

let package = Package(
    name: "SwiftTutorial",
    platforms: [
        .macOS(.v12),
        .iOS(.v15)
    ],
    products: [
        .executable(
            name: "SwiftTutorial",
            targets: ["SwiftTutorial"]),
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "SwiftTutorial",
            dependencies: []),
        .testTarget(
            name: "SwiftTutorialTests",
            dependencies: ["SwiftTutorial"]),
    ]
)`;

        fs.writeFileSync(path.join(projectPath, 'Package.swift'), packageContent);

        // Create Sources directory and main.swift
        const sourcesPath = path.join(projectPath, 'Sources', 'SwiftTutorial');
        fs.mkdirSync(sourcesPath, { recursive: true });
        
        const mainContent = `print("Hello, Swift Tutorial!")`;
        fs.writeFileSync(path.join(sourcesPath, 'main.swift'), mainContent);

        // Create Tests directory and test file
        const testsPath = path.join(projectPath, 'Tests', 'SwiftTutorialTests');
        fs.mkdirSync(testsPath, { recursive: true });
        
        const testContent = `import XCTest
@testable import SwiftTutorial

final class SwiftTutorialTests: XCTestCase {
    func testExample() throws {
        XCTAssertTrue(true)
    }
}`;
        fs.writeFileSync(path.join(testsPath, 'SwiftTutorialTests.swift'), testContent);

        // Open the project in VS Code
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(projectPath));
    }

    public async saveTutorialState(): Promise<void> {
        await this.context.workspaceState.update('swiftTutorialState', this.tutorialState);
    }

    public isStepCompleted(stepId: string): boolean {
        return this.tutorialState[stepId] || false;
    }

    public markStepCompleted(stepId: string): void {
        this.tutorialState[stepId] = true;
        this.saveTutorialState();
    }
} 