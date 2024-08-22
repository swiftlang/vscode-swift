//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import {
    Configuration,
    ConfigurationSection,
    WorkspaceConfiguration,
} from "../../src/configuration";

class TestConfigurationSection implements ConfigurationSection {
    private configuration: Map<string, { value: unknown }>;

    constructor(private userConfiguration?: TestConfigurationSection) {
        this.configuration = new Map();
    }

    get<T>(section: string, defaultValue: T): T {
        const workspaceValue = this.configuration.get(section);
        if (workspaceValue) {
            return workspaceValue.value as T;
        }
        const userValue = this.userConfiguration?.configuration.get(section);
        if (userValue) {
            return userValue.value as T;
        }
        return defaultValue;
    }

    update<T>(section: string, value: T) {
        this.configuration.set(section, { value });
    }
}

export class TestConfiguration implements Configuration {
    private userConfiguration: TestConfigurationSection;
    private configurations: Map<vscode.WorkspaceFolder, TestConfigurationSection>;

    constructor(workspaceFolders: vscode.WorkspaceFolder[]) {
        this.userConfiguration = new TestConfigurationSection();
        this.configurations = new Map();
        for (const folder of workspaceFolders) {
            this.configurations.set(folder, new TestConfigurationSection(this.userConfiguration));
        }
    }

    get(scope?: vscode.ConfigurationScope): WorkspaceConfiguration {
        return new WorkspaceConfiguration(this.getTestConfigurationSection(scope));
    }

    private getTestConfigurationSection(
        scope?: vscode.ConfigurationScope
    ): TestConfigurationSection {
        if (scope instanceof vscode.Uri) {
            for (const [workspaceFolder, configuration] of this.configurations.entries()) {
                if (scope.fsPath.startsWith(workspaceFolder.uri.fsPath)) {
                    return configuration;
                }
            }
            return this.userConfiguration;
        }
        return this.userConfiguration;
    }
}
