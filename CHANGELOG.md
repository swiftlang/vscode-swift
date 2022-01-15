# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## 0.2.0 - 2022-01-20

### Added
- Build tasks for all folders in the workspace.
- Resolve and update commands which update current folder.
- Reset package and clean build commands.
- Restart language client in correct folder when moving between folders in the workspace.
- "sourcekit-lsp.serverPath" configuration option for path to sourcekit-lsp executable.
- Status item when loading packages.
- Resolve and reset package buttons to dependency view.
- Cache contents of Package.resolved for use across different systems.
- Function documentation comment completion. Type "///" on line above function to activate. 

### Changed
- Cleanup Language client code
- Package dependency view updates based on current folder

### Fixed
- Use correct workspace folder in launch.json program name

## 0.1.1 - 2021-12-27

### Fixed

- Configuring of CodeLLDB while running in a remote container

## 0.1.0 - 2021-12-24

### Added

- Automatically create build tasks based on the targets in a package.
- Show package dependencies in the Explorer.
- Package dependencies view has button to update package dependencies.
- Resolve dependencies when **Package.swift** or **Package.resolved** change.
- Integrated with the SourceKit-LSP server.
- Generate launch configurations for each executable and tests in **Package.swift**.
- "Swift" output channel providing a history of all actions.
- Status bar item for when resolve or update tasks are running.
- Bundle using ESBuild.
- Configuration parameter `path` to define where Swift executables are found.
- Configuration parameter `buildArguments` to add custom build arguments.
- Configure CodeLLDB to work with Swift.
