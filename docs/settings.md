# Extension Settings

The Visual Studio Code Swift extension comes with a number of settings you can use to control how it works. Detailed descriptions of each setting is provided in the extension settings page.

This document outlines useful configuration options not covered by the settings descriptions in the extension settings page.

## Command Plugins

Swift packages can define [command plugins](https://github.com/swiftlang/swift-package-manager/blob/main/Documentation/Plugins.md) that can perform arbitrary tasks. For example, the [swift-format](https://github.com/swiftlang/swift-format) package exposes a `format-source-code` command which will use swift-format to format source code in a folder. These plugin commands can be invoked from VS Code using `> Swift: Run Command Plugin`.

A plugin may require permissions to perform tasks like writing to the file system or using the network. If a plugin command requires one of these permissions, you will be prompted in the integrated terminal to accept them. If you trust the command and wish to apply permissions on every command execution, you can configure a setting in your `settings.json`.

```json
{
  "swift.pluginPermissions": {
    "PluginName:command": {
      "allowWritingToPackageDirectory": true,
      "allowWritingToDirectory": "/some/path/",
      "allowNetworkConnections": "all",
      "disableSandbox": true
    }
  }
}
```

A key of `PluginName:command` will set permissions for a specific command. A key of `PluginName` will set permissions for all commands in the plugin. If you'd like the same permissions to be applied to all plugins use `*` as the plugin name. Precedence order is determined by specificity, where more specific names take priority. The name `*` is the least specific and `PluginName:command` is the most specific.

Alternatively, you can define a task in your tasks.json and define permissions directly on the task. This will create a new entry in the list shown by `> Swift: Run Command Plugin`.

```json
{
  "type": "swift-plugin",
  "command": "command_plugin",
  "args": ["--foo"],
  "cwd": "command-plugin",
  "problemMatcher": ["$swiftc"],
  "label": "swift: command-plugin from tasks.json",

  "allowWritingToPackageDirectory": true,
  "allowWritingToDirectory": "/some/path/",
  "allowNetworkConnections": "all",
  "disableSandbox": true
}
```

If you'd like to provide specific arguments to your plugin command invocation you can  use the `swift.pluginArguments` setting. Defining an array for this setting applies the same arguments to all plugin command invocations.

```json
{
  "swift.pluginArguments": ["-c", "release"]
}
```

Alternatively you can specfiy which specific command the arguments should apply to using `PluginName:command`. A key of `PluginName` will use the arguments for all commands in the plugin. If you'd like the same arguments to be used for all plugins use `*` as the plugin name.

```json
{
  "swift.pluginArguments": {
    "PluginName:command": ["-c", "release"]
  }
}
```

## SourceKit-LSP

[SourceKit-LSP](https://github.com/apple/sourcekit-lsp) is the language server used by the the Swift extension to provide symbol completion, jump to definition etc. It is developed by Apple to provide Swift and C language support for any editor that supports the Language Server Protocol.

### Background Indexing

If you're using a nightly (`main`) or recent `6.0` toolchain you can enable support for background indexing in Sourcekit-LSP. This removes the need to do a build before getting code completion and diagnostics.

To enable support, set the `swift.sourcekit-lsp.backgroundIndexing` setting to `true`.

### Support for 'Expand Macro'

If you are using a nightly (`main`) toolchain you can enable support for the "Peek Macro" Quick Action, accessible through the light bulb icon when the cursor is on a macro.

To enable support, set the following Sourcekit-LSP server arguments in your settings.json, or add two new entries to the `Sourcekit-lsp: Server Arguments` entry in the extension settings page.

```
"swift.sourcekit-lsp.serverArguments": [
  "--experimental-feature",
  "show-macro-expansions"
]
```
