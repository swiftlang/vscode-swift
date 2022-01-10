# Swift for Visual Studio Code

This extension adds language support for Swift to Visual Studio Code. It supports:

* Code completion
* Jump to definition, peek definition, find all references, symbol search
* Error annotations and apply suggestions from errors
* Automatic generation of launch configurations for debugging with [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)
* Automatic task creation
* Package dependency view

Swift support uses [SourceKit LSP](https://github.com/apple/sourcekit-lsp) for the [language server](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/) to power code completion and [LLDB](https://github.com/vadimcn/vscode-lldb) to enable debugging. 

The extension is developed by members of the Swift Community and maintained by the [SSWG](https://www.swift.org/sswg/). The aim is to provide a first-class, feature complete extension to make developing Swift applications on all platforms a seamless experience.

If you experience any issues or want to propose new features please [create an issue](https://github.com/swift-server/swift-vscode/issues/new) or post on the `#vscode-swift` channel on [Slack](https://swift-server.slack.com).

## Contributing

The Swift for Visual Studio Code extension is a community driven project, developed by the amazing Swift community. Any kind of contribution is appreciated, including code, tests and documentation. For more details see [CONTRIBUTING.md](CONTRIBUTING.md).

## Installation

For the extension to work, you must have Swift installed on your system. Please see the [Getting Started Guide on Swift.org](https://www.swift.org/getting-started/) for details on how to install Swift on your system. Install the extension from [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=sswg.swift-lang) and open a Swift package! You'll be prompted to install and configure the CodeLLDB extension, which you should do so.

## Features

### Automatic task creation

For workspaces that contain a **Package.swift** file, this extension will create the following tasks:

- **Build All Targets** (`swift build` - both debug and release)
- **Clean Build Artifacts** (`swift package clean`)
- **Resolve Package Dependencies** (`swift package resolve`)
- **Update Package Dependencies** (`swift package update`)

These tasks are available via **Terminal ▸ Run Task...** and **Terminal ▸ Run Build Task...**.

### Package dependencies

If your workspace contains a package that has dependencies, this extension will add a **Package Dependencies** view to the Explorer:

![](images/package-dependencies.png)

Additionally, the extension will monitor **Package.swift** and **Package.resolved** for changes, resolve any changes to the dependencies, and update the view as needed.

> **Note**: When browsing the files in a package, Visual Studio Code may also open these files in the Explorer. If this is undesirable, open **Preferences ▸ Settings** and set **Explorer: Auto Reveal** to `false`.

### Debugging

The Swift extension uses the [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb) extension for debugging.

When you open a Swift package (a directory containing a **Package.swift**) the extension creates build tasks and launch configurations for each executable. If the package contains tests, the extension creates a configuration to run the tests. These all use the CodeLLDB extension as a debugger. 

Press `F5` to run an executable and start debugging. If you have multiple launch configurations you can choose which launch configuration to use in the debugger view. 

CodeLLDB has a version of `lldb` packaged with it and by default this is the version it uses for debugging. However, this version of `lldb` does not work with Swift. Fortunately, CodeLLDB allows you to choose an alternate version. The Swift extension will attempt to ascertain which version is required and give you the option to update the CodeLLDB configuration. 

### Documentation

For docs on how to use the extension, see the [Documentation](Documentation/).