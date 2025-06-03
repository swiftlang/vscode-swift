# Debugging

Debug your Swift executables using LLDB.

When you open a Swift package (a directory containing a `Package.swift` file), the extension automatically generates build tasks and launch configurations for each executable within the package. Additionally, if the package includes tests, the extension creates a configuration specifically designed to run those tests. These configurations all leverage the CodeLLDB extension as the debugger of choice.

> 💡 Tip: Debugging workflows are common to all VS Code extensions. See the [VS Code documentation about testing](https://code.visualstudio.com/docs/debugtest/testing) for a more in-depth overview.
>
> Debugging works best when using a version of the Swift toolchain 6.0 or higher.

Use the **Run > Start Debugging** menu item to run an executable and start debugging. If you have multiple launch configurations you can choose which launch configuration to use in the debugger view.
