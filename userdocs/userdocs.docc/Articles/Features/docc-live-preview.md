# Documentation Live Preview

Show a live preview of your Swift documentation while editing.

> Note: This feature is only available when using a Swift toolchain 6.2 or higher running on macOS or Linux.

The Swift toolchain comes with a built-in documentation compiler called DocC that can be used to build documentation for your Swift code. This documentation can then be distributed to developers or other contributors. It's what we used to make the documentation for vscode-swift! You can learn more about DocC by reading [the documentation on the Swift organization's website](https://www.swift.org/documentation/docc/).

The Swift extension for VS Code can show you a side-by-side live preview of your documentation as you edit it. This feature can be accessed via the Preview Swift Documentation button at the top right of an editor or with the `Swift: Preview Documentation` command in the command palette. This will open up a new editor pane with your rendered documentation:

![An animation showing how to launch documentation live preview.](docc-live-preview.gif)
