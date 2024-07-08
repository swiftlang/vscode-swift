# Changelog

## 1.10.4 - 2024-07-08

### Added

- `Swift` terminal profile
- Set Swift environment variables in the integrated terminal

### Fixed

- Parameterized `swift-testing` tests inherit tags
- Updated the Swiftly URL
- Fix duplicate symbol linker error when building Windows tests with coverage
- Update `DEVELOPER_DIR` for macOS toolchain selection

## 1.10.3 - 2024-06-24

### Added

- Issue diagnosis command `swift: Capture VS Code Swift Diagnostic Bundle`

### Fixed

- No longer show XCTest failures under Problems view
- Fix an issue where stale diagnostics were not being removed

## 1.10.2 - 2024-06-18

### Added

- Release test run profiles.
- Allow SourceKit-LSP to write to multiple output channels.
- Warn users about lack of symlink privileges on Windows

### Changed

- Renamed `swift-latest` to `Latest Installed Toolchain` in toolchain selection dialog.
- Improved LSP configuration change notification.
- Improved toolchain error message when swift.path exists in settings.

### Fixed

- Removed stale swiftc diagnostics when loading sourcekit-lsp diagnostics.
- Only create fifo pipe when running swift-testing tests.
- Always register the swift-lldb debug adapter provider.
- Use proper lldb path on Windows.

## 1.10.1 - 2024-06-10

### Fixed

- Fix XCTest argument format when debugging multiple tests
- Add user defined and optional sanitizer/diagnostics arguments to test builds
- Silence Terminal on test runs.

## 1.10.0 - 2024-06-07

### Added

- Support for swift-testing.
- Toolchain selection command `swift: Select Toolchain...`.
- Create new Swift project command `swift: Create New Project...`.
- Use custom LSP requests for test discovery.
- Support for recording multiple issues per test.
- Code snippets for common actions, like creating tests, availability conditions, option sets.
- CustomExecution for swift tasks.
- UI showing Swift build status

### Changed

- Replace test coverage support with native VSCode coverage APIs.
- Merge SourceKit-LSP diagnostics with diagnostics from Swift compiler.
- Removed `swift.problemMatchCompileErrors` as it is no longer needed.
- Deprecate `swift.sourcekit-lsp.serverPath` setting.
- Only disable build tasks, while other tasks are running, in Swift versions earlier than 6. As Swift 6 manages access to `.build` folder.

### Other

- Removed CI for Swift 5.4/5.5

## 1.9.0 - 2024-04-15

### Added
- Running tests in parallel. It is available from the drop-down next to the run button at the top of the TestExplorer. It is not available while debugging and parsing of XCT failure messages does not work prior to Swift 6.

### Changed
- If using Swift 5.10 allow for InlayHint text edits.
- If using Swift 6 name of debug adapter has changed from `lldb-vscode` to `lldb-dap`.

### Fixed
- Don't check if line above is a comment if you are on line 0 in comment completion code.

## 1.8.1 - 2024-03-06

### Fixed

- Loading of package dependencies for Swift 5.10 packages.

## 1.8.0 - 2024-02-21

### Added
- Platform specific settings in the swift task definition.
- Environment variables to set while running a swift task.
- Setting to disable all Swift Package Manager integrations.
- Activate extension when debugging.
- Watch for changes to swift files in test targets and flag 'test discovery is required' if a file changes or is deleted.

### Changed
- Expand `~` in swift file path setting to home directory.
- Don't create test explorer if project has no tests.
- Only run test discovery after a build all task.

### Fixed
- Parsing of test output while debugging tests.

## 1.7.2 - 2024-01-03

### Added
- Setting to control action after a build error: focus on problems pane, focus on terminal or do nothing.

### Changes
- Don't force show test pane when testing starts. Let `Testing: Open Testing` define when test pane should open.

### Fixed
- Setup of URI on readonly document viewer. This fixes jump to symbol in a swiftinterface on Windows

## 1.7.1 - 2023-12-02

### Added
- Task queue operation to spawn a process and parse its output. Using this ensures a build task does not run at the same time.
- Use spawn process task queue operation in test discovery and unedit of modules.

### Changes
- Don't wait for SwiftPM plugin listing to finish before allowing build and run.
- If auto-resolve is disabled then also disable the initial test discovery as this can cause a resolve

### Fixed
- Finding swift executable on non-english installs of Linux

## 1.7.0 - 2023-10-25

Merge debug adapter changes from v1.6.x prerelease builds into main release.

### Changes

- Consolidate common debug configurations when building debug configurations.

### Fixed

- Fix version comparisons for Swift versions 5.10 or greater.
- Increase the size of stdout available to `llvm-cov` process. This fixes displaying test coverage for larger projects.
- Build product instead of target when compiling Swift Snippets. This fixes running of Snippets on macOS.

### Fixed

## 1.6.1 - 2023-10-04 (Toolchain debug adapter preview)

### Added

- Command `swift.attachDebugger` to attach debugger to process

### Fixed

- Path construction on Windows in `launch.json`

## 1.6.0 - 2023-08-31 (Toolchain debug adapter preview)

### Added

- Support for using debug adapter included in Swift toolchain instead of CodeLLDB extension. Currently this is only available in the Windows toolchain. Setting for this is disabled by default.

## 1.5.2 - 2023-09-21

### Fixed

- Toolchain setup for installs that don't include a `usr` folder.

## 1.5.1 - 2023-08-30

### Added

- Support for automatic search of sub-folders for Swift packages. Defaulted to off.
- Debug adapter tracker to catch logging to stdout and stderr. Test output is now visible while debugging tests.

### Fixed

- Removal of workspace folders, now removes all packages associated with the workspace not just the one at the root of the folder.
- Custom Swift path on Windows.
- Fixed adding of packages in sub-folders twice at startup.

## 1.5.0 - 2023-08-18

### Added

- Run/Debug commands that will run/debug executable associated with current active file.
- Run/Debug context menu entries for files that have an associated executable.

### Changes

- **Breaking Change**: SourceKit-LSP configuration settings have been renamed to include a `swift.` prefix to avoid clashes with the original SourceKit-LSP extension.
- If background compilation is enabled, then run build as startup.
- Removed `Run Script` context menu entry when editing a file that is part of a Package.
- Use `tasks.json` default build task, if setup, for Test explorer and background compilation.
- Only use custom macOS test debug configuration, which was added to fix an issue in Swift 5.6, when using Swift 5.6.

### Fixed

- If LSP server shutdown times out, still restart the server.
- Fix version check for versions of Swift prior to 5.4.

## 1.4.0 - 2023-07-05

### Added
- Add sanitizer build setting
- Build tasks are not available while other tasks are running on the package
- Add read-only document provider for swiftinterface files in preparation for go to definition for stdlib/framework symbols.

### Changed
- Add supported language configuration setting to replace Support C/C++ setting
- deprecate Support C/C++ setting
- Remove a number of unnecessary build arguments for Windows when using Swift 5.9 or later
- Configure vscode-lldb to use native expressions

### Fixed
- Require a reload when using the select Xcode developer directory command
- Reporting of errors returned by the compiler without a column number

## 1.3.0 - 2023-05-03

### Added

- Flag to Swift tasks and Swift command plugin tasks that delays queued tasks (eg resolve, update) while task is running. Build tasks have this set to true by default.
- Default settings for popular Swift command plugins (Docc, lambda, SwiftFormat).

### Changed

- Class TestItems status is updated once all the tests inside have completed, instead of once test run has completed.
- Use `--scratch-path` argument instead of `--build-path` when running on Swift 5.8 or later.

## 1.2.1 - 2023-04-13

### Changed

- Run the test executable directly when running tests instead of via `swift test`.

### Fixed

- Ensure we catch errors when decoding `Info.plist` on Windows.
- Killing of `xctest` process if testing is cancelled.

## 1.2.0 - 2023-03-22

### Added

- Accessibilty info to UI elements.
- `sourceLanguage` element to generated launch configurations.
- Option to disable SourceKit-LSP.

### Changed

- Availability of `Run Swift Plugin` command is based off all SwiftPM projects in the workspace, not just the active one.

### Fixed

- Only display link to Package.swift if it exists.

## 1.1.0 - 2023-02-21

### Added

- In-editor display of test coverage results.
- Status Item showing test coverage percentage for current file. Can also be used to toggle display of results.
- Command `Insert Function Comment` that will add function documentation comment.
- Option to disable LSP functionality for C/C++ files. Defaults to disable if C/C++ extension is active.

### Changed

- Clicking on task status item will show terminal output for task.
- Tasks are run using `ProcessExecution` instead of `ShellExecution`.
- When SourceKit-LSP crashes multiple times, display a dialog asking if the user wants to restart it.

### Fixed

- Added workaround for bug in VS Code where starting two similar tasks at the same time would only start one of the tasks.
- Don't parse functions inside parenthesis when constructing function comment headers.

## 1.0.0 - 2023-01-19

### Added

- Command to restart SourceKit-LSP server.
- Test Coverage Report, shown after test coverage has run. Also added command to show reports from previous text coverage runs.

### Fixed

- Setting of error in Test Explorer when test crashes.
- Skip second attempt at building tests when running tests.
- Parsing of test output when line is split across two text buffers.
- Parsing of skipped tests on Linux.

## 0.10.0 - 2023-01-04

### Added

- Support for CMake projects. Initiates extension based off existence of compile_commands.json file.
- `Run command plugin` command. Brings up list of available command plugins with options to edit their parameters.
- TestExplorer run profile to generate Code Coverage lcov files.

### Changed

- Reorder command plugin loading to run after package resolve when loading package.
- Relax rules for test names. Old style linux tests can include spaces, commas in their names.
- Cleaned up XCTest output parsing to reduce duplicated code.
- Update node modules mocha and qs.

### Fixed

- Parsing of multiline error messages in XCTest. Although there are occasions where this will consider too many lines as error output.
- Losing of test item location after building package.
- Finding swift.exe if swift.path is a symbolic link.

## 0.9.0 - 2022-11-01

### Added

- Show error message when extension activation fails.
- `allowWriteToPackageDirectory` option to plugin tasks.

### Changed

- Settings scope for a number of settings so they can be set per workspace folder. Ensure the workspace folder setting is being used. Reverted for a number of settings where per workspace folder setting was not possible.
- Check file type before running Background compilation.

### Fixed

- Ordering of menu entries in Swift context menu.
- Display of package dependencies where package name is different from package identity.
- Ensure we don't add folders twice at startup.

## 0.8.2 - 2022-09-27

### Added

- Setting to disable automatic swift package resolve

### Fixed

- Swift package identity should be case-insensitive
- Reduce command line length when running tests to ensure they run on Windows

## 0.8.1 - 2022-09-09

### Fixed

- Swift submenu is not available when editing non-Swift files
- Correctly indicate the default Xcode installation in Xcode toolchain menu
- Don't attempt to build tests when compiling for iOS, tvOS or watchOS as they don't compile

## 0.8.0 - 2022-09-06

### Added

- Support for Swift Snippets (requires Swift 5.7). Two new commands have been added `Run Swift Snippet` and `Debug Swift Snippet`.
- Sub menu to text editor right click menu. Includes commands not acccessible elsewhere `Run Swift Script`, Snippet commands and `Clean Build`.
- macOS: Command to choose between macOS, iOS, tvOS and watchOS targets. Switching to a non macOS target will give you symbol completion for that target, but building your package will have undefined results.
- macOS: Command to choose between Swift toolchains from all versions of Xcode installed on your system.

### Changed

- When working out project dependencies traverse local dependencies to get full dependency chain
- Changed settings scope for a number of settings so they can be set per workspace folder
- Store hash of `Package.resolved` to compare with new `Package.resolved` whenever it has been updated, to ensure it has actaully changed before running `swift package resolve`.

### Fixed

- Remove `runPlugin` command stub as it does nothing
- Get correct path for Swift when installed on Linux with `swiftenv`

## 0.7.0 - 2022-08-09

### Added

- Support multiple workspace feature of SourceKit-LSP that comes with Swift 5.7.
- Tasks for SwiftPM plugins.

### Changed

- When running with Swift 5.7 or later, migrate to using official implementation of Inlay Hints.
- Cleanup Swift Task implementation, remove `command` property as it is always `swift`.
- Show "no tests" message instead of an error message in Test Explorer when a package has no tests.

### Fixed

- Finding the Swift executable on non-English Linux systems.
- Setting path to executable in `launch.json` when package is in a sub-folder of the workspace.
- Setting focus package at startup when the workspace only has one package.
- Crash while getting Swift version from versions 5.3 or earlier of Swift.
- Local packages not showing in Package Dependency View with Swift 5.6 or later.

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

- Inlay hints (annotations indicating inferred types) now use the standard Visual Studio Code renderer.
- Inlay hints are enabled by default.
- Use Language client middleware to catch Document Symbol requests and use the results to update test list in TestExplorer.
- Don't send unfocus events when opening non-file based view. Means current project stays in focus and project dependencies view won't disappear.
- If user has created a custom version of a build task in `tasks.json` then use that when building for tests, or running background compilation.
- Split settings into sections. Add SourceKit-LSP and Advanced sections.
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

- `SourceKit-LSP: Toolchain Path` setting. You can set this using the `Swift: Path` setting.

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
  - Add To Workspace: Add a locally edited dependency to your VS Code Workspace.
  - Revert To Original Version: Revert locally edited dependency to the version in the Package.swift.
  - View Repository: Open the repository web page for the dependency.
- Support for Swift packages that are in a sub-folder of your workspace.
- New command `Run Swift Script` which will run the currently open file as a Swift script.
- Support for building development version of package via `npm run dev-package`.

### Changed
- Build terminal window is cleared before a build
- When the Swift path or SourceKit-LSP path are changed the extension will restart to ensure the correct versions are used.

### Fixed
- Swift 5.6 will fix the issue of the LSP server not working with new files. If the Swift version is previous to 5.6 then the VS Code extension will restart the LSP server whenever a new file is added.
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
