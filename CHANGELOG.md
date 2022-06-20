# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## 0.6.0 - 2022-06-20

### Added

- Queue Swift tasks, where we can, to ensure we don't have multiple `swift` processes running on the same package at the same time.
- Configuration setting `buildPath` to set a custom build folder.
- The Test Explorer now displays additional states: test enqueued, test running and test errored.
  
### Changed

- Upgrade to VS Code LanguageClient v8

### Fixed

- Increased stdio buffer sizes when running tests to reduce the chance of the process crashing because it ran out of buffer space.

## 0.5.3 - 2022-05-26

### Fixed

- Don't run background compilation when saving `Package.swift` as it clashes with the resolve that runs at the same time.
- Startup of SourceKit-LSP for single swift files in the root of a workspace.
- SourceKit-LSP server crash when opening a file that contains a space.

## 0.5.2 - 2022-05-17

### Added

- Advance Setting: Swift environment variables. These are environment variables to pass to Swift operations.

### Fixed

- Setup of Swift LLDB on Linux.
- If Swift LLDB on Windows setup fails, then fail silently. This indicates the Swift version of LLDB has issues (as is the case in Swift < 5.7) and should not be used. 
- Pass flags used in Swift build to SourceKit-LSP to avoid unnecessary project rebuilds.

## 0.5.1 - 2022-05-10

### Added

- Improve error messaging when extension fails to start.
- Error message for when LLDB setup fails.


### Fixed

- Running non-Swift LLDB on Windows

## 0.5.0 - 2022-05-02

Version 0.5.0 of vscode-swift now requires v1.65.0 of Visual Studio Code

### Added

- Language status item to bottom bar. Pressing `{}` next to `Swift` label will display current swift version and a link to the `Package.swift` for the currently open project.
- Experimental background compilation option. Whenever you save a file it will instigate a build task. This is currently defaulted to off.
- Setting to set environment variables while running tests.
- Setting to output more detailed diagnostics to Swift output pane.
- Setting to set SDK folder (supporting custom SDKs).
- Setting to set additional runtime path (supporting non-standard installation on Windows).
- More informative error messaging when Swift Package fails to load.

### Changed

- Inlay hints (annotations indicating infered types) now use the standard Visual Studio Code renderer.
- Inlay hints are enabled by default.
- Use Language client middleware to catch Document Symbol requests and use the results to update test list in TestExplorer.
- Don't send unfocus events when opening non-file based view. Means current project stays in focus and project dependencies view won't disappear. 
- If user has created a custom version of a build task in `tasks.json` then use that when building for tests, or running background compilation.
- Split settings into sections. Add Sourcekit-LSP and Advanced sections.
- When updating launch.json configurations, show one dialog for each project instead of for each configuration.
- Windows: Removed dependency on `DEVELOPER_DIR` environment variable. Use `SDKROOT` instead.
- Windows: Support Swift 5.7 file structure when finding XCTest.

### Fixed

- Tasks setup in `tasks.json` use the correct version of swift.
- Restarting the LSP server after changing the `serverPath` setting actually uses new setting.
- Windows: Test Explorer messaging when nothing is built.
- Windows: Launching of tests
- Windows: Use Swift LLDB to improve debugging experience.
- CentOS7: Fix the code finding `swift`.

### Removed

- `Sourcekit-LSP: Toolchain Path` setting. You can set this using the `Swift: Path` setting.

## 0.4.3 - 2022-04-05

### Fixed

- Reduce chance of LSP server restart during initialization

## 0.4.2 - 2022-04-04

### Changed

- Build operations triggered by TestExplorer can be cancelled by TestExplorer.

### Fixed

- Centralize task tracking to fix issues with missing task completions.
- Issue with LSP server not starting on Linux.

## 0.4.1 - 2022-03-28

### Added

- Store XCTest class locations in related TestItem. This will augment source code with an icon to run all the tests in a class.
- Cancellation support for tests. When you cancel a test the underlying process is killed (previously it was left running).
- Show Test Explorer output view as soon as testing starts.
- Option to enable/disable the auto-generation of launch.json configurations (default: on).
- Option to add compile errors to the problems view (default: on).

### Changed

- Run non-debug test sessions outside of debugger. Now a crash test will not hang inside the debugger. Also we can stream test output to the test explorer view.
- Show skipped tests as skipped, instead of passed.

## 0.4.0 - 2022-03-22

### Added

- Test Explorer view: List, run and debug tests.
  - Test list is built when project is compiled.
  - Use LSP server to update test list when you save a file, also use these results to set location data for tests.
- Package dependency view includes project name in title.

### Changed

- The package dependency view is always visible if your project has a Package.swift regardless of whether it has any dependencies.
- Don't completely destroy the Language client when changing LSP server workspace folder. 
- Conditionally add `--enable-test-discovery` based on Swift version and existence of `LinuxMain.swift`.

### Fixed

- Parsing no package error message from Swift 5.6.
- Leaving a temporary vscode-swift folder after every session. There is now one temp folder and files written into it are deleted as soon as they are no longer needed.
- Loading of Packages from Swift 5.6 projects

### Removed

- Automatic generation of launch target for running tests. This is no longer needed now we have the test explorer.


## 0.3.0 - 2022-02-22

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

### Changed
- Build terminal window is cleared before a build
- When the Swift path or SourceKit-LSP path are changed the extension will restart to ensure the correct versions are used.

### Fixed
- Swift 5.6 will fix the issue of the LSP server not working with new files. If the Swift version is previous to 5.6 then the VSCode extension will restart the LSP server whenever a new file is added.
- The LSP server works on single Swift files outside of a Package.swift.
- Windows debug build options for generating dwarf debug output.

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
