# Debugging

vscode-swift allows you to debug your Swift packages.

> Tip: Debugging works best when using a version of the Swift toolchain 6.0 or higher

When you open a Swift package (a directory containing a `Package.swift` file), the extension automatically generates build tasks and launch configurations for each executable within the package. Additionally, if the package includes tests, the extension creates a configuration specifically designed to run those tests. These configurations all leverage the CodeLLDB extension as the debugger of choice.

Use the **Run > Start Debugging** menu item to run an executable and start debugging. If you have multiple launch configurations you can choose which launch configuration to use in the debugger view.

Debugging uses workflows common to all VSCode extensions. For more information see https://code.visualstudio.com/docs/editor/debugging