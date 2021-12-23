# Swift for Visual Studio Code

This extension adds language support for Swift to Visual Studio Code. It supports:

* Automatic task creation
* Package dependency view
* Code completion
* Jump to definition, peek definition, find all references, symbol search
* Error annotations and apply suggestions from errors

Swift support uses [SourceKit LSP](https://github.com/apple/sourcekit-lsp) for the [language server](https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/) to power code completion and [LLDB](https://github.com/vadimcn/vscode-lldb) to enable debugging. 

The extension is developed by members of the Swift Community and maintained by the [SSWG](https://www.swift.org/sswg/). The aim is to provide a first-class, feature complete extension to make developing Swift applications on all platforms a seamless experience.

If you experience any issues or want to propose new features please [create an issue](https://github.com/swift-server/swift-vscode/issues/new) or post on the `#vscode-swift` channel on [Slack](https://swift-server.slack.com).

## Contributing

The Swift for Visual Studio Code extension is a community driven project, developed by the amazing Swift community. Any kind of contribution is appreciated, including code, tests and documentation. For more details see [CONTRIBUTING.md](CONTRIBUTING.md).

## Installation

For the extension to work, you must have Swift installed on your system. Please see the [Getting Started Guide on Swift.org](https://www.swift.org/getting-started/) for details on how to install Swift on your system. Install the extension from [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=sswg.swift) and open a Swift project!

## Configuration

You can find the settings for this extension in **Preferences ▸ Settings** under **Extensions ▸ Swift** or by searching for the prefix `swift`.

The following settings are available:

- **excludePathsFromPackageDependencies**: A list of paths to exclude from the Package Dependencies view.

## Features

### Automatic task creation

For workspaces that contain a **Package.swift** file, this extension will create the following tasks:

- **Build All Targets** (`swift build`)
- **Clean Build Artifacts** (`swift package clean`)
- **Resolve Package Dependencies** (`swift package resolve`)
- **Update Package Dependencies** (`swift package update`)
- **Run** (`swift run`), for every executable target in the package.

These tasks are available via **Terminal ▸ Run Task...** and **Terminal ▸ Run Build Task...**.

You can customize a task by clicking the gear icon next to it. This will add the task to **tasks.json**, where you can customize its properties. For example, here’s how you add `--env production` command line arguments to the **Run** target from a Vapor project:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "swift",
            "command": "swift",
            "args": [
                "run",
                "Run",
                "--env",
                "production"
            ],
            "group": "build",
            "label": "swift: Run in Production Environment"
        }
    ]
}
```

Custom tasks support the following properties:

- **type** (required): must be set to `"swift"`.
- **command** (required): the base command to execute. Don’t include any arguments as the command will be quoted if it contains spaces.
- **args** (required): list of arguments for the base command. Each argument will be individually quoted if it contains spaces.
- **group** (optional): either `"build"` or `"test"`.
- **label** (optional): a name for the task. You should overwrite this property to differentiate your customized task from the ones provided by this extension.
- **detail** (optional): a description of this task. If not provided, the task’s command (including its arguments) will be used instead.

### Package dependencies

If your workspace contains a package that has dependencies, this extension will add a **Package Dependencies** view to the Explorer:

![](images/package-dependencies.png)

Additionally, the extension will monitor **Package.swift** and **Package.resolved** for changes, resolve any changes to the dependencies, and update the view as needed.

> **Note**: When browsing the files in a package, Visual Studio Code may also open these files in the Explorer. If this is undesirable, open **Preferences ▸ Settings** and set **Explorer: Auto Reveal** to `false`.