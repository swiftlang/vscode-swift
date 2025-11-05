# Swift for Visual Studio Code

This extension adds language support for Swift to Visual Studio Code, providing a seamless experience for developing Swift applications on all supported platforms. It supports features such as:

* Code completion
* Jump to definition, peek definition, find all references and symbol search
* Error annotations and fix suggestions
* Automatic generation of launch configurations for debugging with [LLDB DAP](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.lldb-dap)
* Automatic task creation
* A Project Panel to quickly run actions and view dependencies
* Test Explorer view

> **Note**  
> Most features of the Swift for Visual Studio Code extension only work with projects that build with Swift Package Manager. These projects will have a `Package.swift` file in their root folder. Support for Xcode projects (`.xcodeproj`) is limited.

### Creating New Projects
<img src="assets/walkthrough/images/createNewProject.gif" width="700">

### Running Executables
<img src="assets/walkthrough/images/runExecutable.gif" width="700">

### Debugging Executables
<img src="assets/walkthrough/images/debugExecutable.gif" width="700">

### Running Tests
<img src="assets/walkthrough/images/runTests.gif" width="700">

# Documentation

The [getting started guide](https://www.swift.org/documentation/articles/getting-started-with-vscode-swift.html) and [official documentation](https://docs.swift.org/vscode/documentation/userdocs) for this extension are available on [swift.org](https://www.swift.org).

This extension uses [SourceKit LSP](https://github.com/apple/sourcekit-lsp) for the [language server](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/), which powers code completion. It also has a dependency on the [LLDB DAP](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.lldb-dap) extension to enable debugging.

To propose new features, you can post on the [swift.org forums](https://forums.swift.org) in the [VS Code Swift Extension category](https://forums.swift.org/c/related-projects/vscode-swift-extension/). If you run into something that doesn't work the way you'd expect, you can [file an issue in the GitHub repository](https://github.com/swiftlang/vscode-swift/issues/new).

## Contributing

The Swift for Visual Studio Code extension is based on an extension originally created by the [Swift Server Working Group](https://www.swift.org/sswg/). It is now maintained as part of the [swiftlang organization](https://github.com/swiftlang/), and the original extension is deprecated. Contributions, including code, tests, and documentation, are welcome. For more details, refer to [CONTRIBUTING.md](CONTRIBUTING.md).

To provide clarity on the expectations for our members, Swift has adopted the code of conduct outlined in the [Contributor Covenant](https://www.contributor-covenant.org). This widely recognized document effectively encapsulates our values. For more information, please refer to the [Code of Conduct](https://swift.org/code-of-conduct/).
