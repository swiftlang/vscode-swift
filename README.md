# Swift for Visual Studio Code

This extension adds language support for Swift to Visual Studio Code, providing a seamless experience for developing Swift applications on all supported platforms. It supports:

* Code completion
* Jump to definition, peek definition, find all references, symbol search
* Error annotations and apply suggestions from errors
* Automatic generation of launch configurations for debugging with [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)
* Automatic task creation
* Package dependency view
* Test Explorer view

This extension uses [SourceKit LSP](https://github.com/apple/sourcekit-lsp) for the [language server](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/), which powers code completion. It also has a dependency on [LLDB DAP](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.lldb-dap) for debugging.

To propose new features, you can post on the [swift.org forums](https://forums.swift.org) in the [VS Code Swift Extension category](https://forums.swift.org/c/related-projects/vscode-swift-extension/). If you run into something that doesn't work the way you'd expect, you can [file an issue in the GitHub repository](https://github.com/swiftlang/vscode-swift/issues/new).

## Installation

The Swift extension is supported on macOS, Linux, and Windows. To install, firstly ensure you have [Swift installed on your system](https://www.swift.org/install/). Then [install the Swift extension](https://marketplace.visualstudio.com/items?itemName=swiftlang.swift-vscode). Once your machine is ready, you can get started with the **Swift: Create New Project...** command.

## Features

### Language features

The extension provides language features such as code completion and jump to definition via [SourceKit-LSP](https://github.com/apple/sourcekit-lsp). To ensure the extension functions correctly, it’s important to first build the project so that SourceKit-LSP has access to all the symbol data. Whenever you add a new dependency to your project, make sure to rebuild it so that SourceKit-LSP can update its information.

### Automatic task creation

For workspaces that contain a **Package.swift** file, this extension will add the following tasks:

- **Build All**: Build all targets in the Package
- **Build Debug <Executable>**: Each executable in a Package.swift get a task for building a debug build
- **Build Release <Executable>**: Each executable in a Package.swift get a task for building a release build

These tasks are available via **Terminal ▸ Run Task...** and **Terminal ▸ Run Build Task...**.

### Commands

The extension adds the following commands, available via the command palette.

#### Configuration

- **Create New Project...**: Create a new Swift project using a template. This opens a dialog to guide you through creating a new project structure.
- **Create New Swift File...**: Create a new `.swift` file in the current workspace.
- **Select Toolchain**: Select the locally installed Swift toolchain (including Xcode toolchains on macOS) that you want to use Swift tools from.

The following command is only available on macOS:

- **Select Target Platform**: This is an experimental command that offers code editing support for iOS, tvOS, watchOS and visionOS projects.

#### Building and Debugging

- **Run Build**: Run `swift build` for the package associated with the open file.
- **Debug Build**: Run `swift build` with debugging enabled for the package associated with the open file, launching the binary and attaching the debugger.
- **Attach to Process...**: Attach the debugger to an already running process for debugging.
- **Clean Build Folder**: Clean the build folder for the package associated with the open file, removing all previously built products.

#### Dependency Management

- **Resolve Package Dependencies**: Run `swift package resolve` on packages associated with the open file.
- **Update Package Dependencies**: Run `swift package update` on packages associated with the open file.
- **Reset Package Dependencies**: Run `swift package reset` on packages associated with the open file.
- **Add to Workspace**: Add the current package to the active workspace in VS Code.
- **Clean Build**: Run `swift package clean` on packages associated with the open file.
- **Open Package.swift**: Open `Package.swift` for the package associated with the open file.
- **Use Local Version**: Switch the package dependency to use a local version of the package instead of the remote repository version.
- **Edit Locally**: Make the package dependency editable locally, allowing changes to the dependency to be reflected immediately.
- **Revert To Original Version**: Revert the package dependency to its original, unedited state after local changes have been made.
- **View Repository**: Open the external repository of the selected Swift package in a browser.

#### Testing

- **Test: Run All Tests**: Run all the tests across all test targes in the open project.
- **Test: Rerun Last Run**: Perform the last test run again.
- **Test: Open Coverage**: Open the last generated coverage report, if one exists.
- **Test: Run All Tests in Parallel**: Run all tests in parallel. This action only affects XCTests. Swift-testing tests are parallel by default, and their parallelism [is controlled in code](https://developer.apple.com/documentation/testing/parallelization).

#### Snippets and Scripts

- **Insert Function Comment**: Insert a standard comment block for documenting a Swift function in the current file.
- **Run Swift Script**: Run the currently open file, as a Swift script. The file must not be part of a build target. If the file has not been saved it will save it to a temporary file so it can be run.
- **Run Swift Snippet**: If the currently open file is a Swift snippet then run it.
- **Debug Swift Snippet**: If the currently open file is a Swift snippet then debug it.

#### Diagnostics

- **Capture VS Code Swift Diagnostic Bundle**: Capture a diagnostic bundle from VS Code, containing logs and information to aid in troubleshooting Swift-related issues.
- **Clear Diagnostics Collection**: Clear all collected diagnostics in the current workspace to start fresh.
- **Restart LSP Server**: Restart the Swift Language Server Protocol (LSP) server for the current workspace.
- **Re-Index Project**: Force a re-index of the project to refresh code completion and symbol navigation support.

### Package dependencies

If your workspace contains a package that has dependencies, this extension will add a **Package Dependencies** view to the Explorer:

![](images/package-dependencies.png)

Additionally, the extension will monitor `Package.swift` and `Package.resolved` for changes, resolve any changes to the dependencies, and update the view as needed.

### Debugging

The Swift extension uses the [LLDB DAP](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.lldb-dap) extension for debugging.

When you open a Swift package (a directory containing a `Package.swift` file), the extension automatically generates build tasks and launch configurations for each executable within the package. Additionally, if the package includes tests, the extension creates a configuration specifically designed to run those tests. These configurations all leverage the LLDB DAP extension as the debugger of choice.

Use the **Run > Start Debugging** menu item to run an executable and start debugging. If you have multiple launch configurations you can choose which launch configuration to use in the debugger view.

LLDB DAP is only available starting in Swift 6.0. On older versions of Swift the [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) extension will be used for debugging instead. You will be prompted to install the CodeLLDB extension in this case.

CodeLLDB includes a version of `lldb` that it uses by default for debugging, but this version of `lldb` doesn’t support Swift. The Swift extension will automatically identify the required version and offer to update the CodeLLDB configuration as necessary so that debugging is supported.

### Test Explorer

If your package contains tests then they can be viewed, run and debugged in the Test Explorer.

![](images/test-explorer.png)

Once your project is built, the Test Explorer will list all your tests. These tests are grouped by package, then test target, and finally, by XCTestCase class. From the Test Explorer, you can initiate a test run, debug a test run, and if a file has already been opened, you can jump to the source code for a test.

### Documentation

* [Extension Settings](docs/settings.md)
* [Test Coverage](docs/test-coverage.md)
* [Visual Studio Code Dev Containers](docs/remote-dev.md)

## Contributing

The Swift for Visual Studio Code extension is based on an extension originally created by the [Swift Server Working Group](https://www.swift.org/sswg/). It is now maintained as part of the [swiftlang organization](https://github.com/swiftlang/), and the original extension is deprecated. Contributions, including code, tests, and documentation, are welcome. For more details, refer to [CONTRIBUTING.md](CONTRIBUTING.md).

To provide clarity on the expectations for our members, Swift has adopted the code of conduct outlined in the [Contributor Covenant](https://www.contributor-covenant.org). This widely recognized document effectively encapsulates our values. For more information, please refer to the [Code of Conduct](https://swift.org/code-of-conduct/).
