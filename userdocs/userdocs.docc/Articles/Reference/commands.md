# Commands

Useful VS Code commands added by the Swift extension.

> 💡 Tip: Commands can be accessed from the VS Code command palette which is common to all VS Code extensions. See the [VS Code documentation about the command palette](https://code.visualstudio.com/docs/getstarted/userinterface#_command-palette) for a more in-depth overview.

The Swift extension adds the following commands, each prefixed with `"Swift: "` in the command palette.

#### Configuration

- **`Create New Project...`** - Create a new Swift project using a template. This opens a dialog to guide you through creating a new project structure.
- **`Create New Swift File...`** - Create a new `.swift` file in the current workspace.
- **`Select Toolchain...`** - Select the locally installed Swift toolchain (including Xcode toolchains on macOS) that you want to use Swift tools from.

The following command is only available on macOS:

- **`Select Target Platform...`** - An experimental command available in Swift 6.1 that offers code completion for iOS, tvOS, watchOS, and visionOS projects.

#### Building and Debugging

- **`Run Build`** - Run `swift build` for the package associated with the open file.
- **`Debug Build`** - Run `swift build` with debugging enabled for the package associated with the open file, launching the binary and attaching the debugger.
- **`Attach to Process...`** - Attach the debugger to an already running process for debugging.
- **`Clean Build Folder`** - Clean the `.build` folder for the package associated with the open file, removing all previously built products.

#### Dependency Management

- **`Resolve Package Dependencies`** - Run `swift package resolve` on packages associated with the open file.
- **`Update Package Dependencies`** - Run `swift package update` on packages associated with the open file.
- **`Reset Package Dependencies`** - Run `swift package reset` on packages associated with the open file.
- **`Add to Workspace`** - Add the current package to the active workspace in VS Code.
- **`Clean Build`** - Run `swift package clean` on packages associated with the open file.
- **`Open Package.swift`** - Open `Package.swift` for the package associated with the open file.
- **`Use Local Version`** - Switch the package dependency to use a local version of the package instead of the remote repository version.
- **`Edit Locally`** - Make the package dependency editable locally, allowing changes to the dependency to be reflected immediately.
- **`Revert To Original Version`** - Revert the package dependency to its original, unedited state after local changes have been made.
- **`View Repository`** - Open the external repository of the selected Swift package in a browser.

#### Testing

- **`Test: Run All Tests`** - Run all the tests across all test targes in the open project.
- **`Test: Rerun Last Run`** - Perform the last test run again.
- **`Test: Open Coverage`** - Open the last generated coverage report, if one exists.
- **`Test: Run All Tests in Parallel`** - Run all tests in parallel. This action only affects XCTests. Swift-testing tests are parallel by default, and their parallelism [is controlled in code](https://developer.apple.com/documentation/testing/parallelization).

#### Snippets and Scripts

- **`Insert Function Comment`** - Insert a standard comment block for documenting a Swift function in the current file.
- **`Run Swift Script`** - Run the currently open file, as a Swift script. The file must not be part of a build target. If the file has not been saved it will save it to a temporary file so it can be run.
- **`Run Swift Snippet`** - If the currently open file is a Swift snippet then run it.
- **`Debug Swift Snippet`** - If the currently open file is a Swift snippet then debug it.

#### Diagnostics

- **`Capture Diagnostic Bundle`** - Capture a diagnostic bundle from VS Code, containing logs and information to aid in troubleshooting Swift-related issues.
- **`Clear Diagnostics Collection`** - Clear all collected diagnostics in the current workspace to start fresh.
- **`Restart LSP Server`** - Restart the Swift Language Server Protocol (LSP) server for the current workspace.
- **`Re-Index Project`** - Force a re-index of the project to refresh code completion and symbol navigation support.