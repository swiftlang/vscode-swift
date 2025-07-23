The Swift extension automatically detects your installed Swift toolchain. However, it also provides a command called `Swift: Select Toolchain...` which can be used to select between toolchains if you have multiple installed.

You may be prompted to select where to configure this new path. Your options are to:

- `Save it in User Settings`
- `Save it in Workspace Settings`

Keep in mind that Workspace Settings take precedence over `User Settings`.

The Swift extension will then prompt you to reload the extension in order to pick up the new toolchain. The extension will not use the new toolchain until the extension is restarted.