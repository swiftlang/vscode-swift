# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## 0.3.0

### Added
- Function documentation comment completion. Type "///" on line above function to activate. 
- Package dependency view has new right click menu. Menu entries include:
  - Use Local Version: Use local version of package dependency.
  - Add To Workspace: Add a locally edited dependency to your VSCode Workspace.
  - Revert To Original Version: Revert locally edited dependency to the version in the Package.swift.
  - View Repository: Open the repository web page for the dependency.
- Support for Swift packages that are in a sub-folder of your workspace.
- New command `Run Swift Script` which will run the currently open file as a Swift script.
- Support for building development version of package via `npm run dev-package`.

### Fixed
- Swift 5.6 will fix the issue of the LSP server not working with new files. If the Swift version is previous to 5.6 then the VSCode extension will restart the LSP server whenever a new file is added.
- The LSP server works on single Swift files outside of a Package.swift.

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
