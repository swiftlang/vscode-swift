# Supported Toolchains

vscode-swift supports several versions of the Swift toolchain.

vscode-swift supports the following Swift toolchains:
 * 5.9
 * 5.10
 * 6.0
 * 6.1

The extension also strives to work with the latest nightly toolchains built from the main branch.

Certain features of vscode-swift will only work with newer versions of the toolchains. We recommend using the latest version of the Swift toolchain to get the most benefit of the extension. The following features only work with certain toolchains as listed:

Feature                  | Minimum Toolchain Required                     
------------------------ | ------------------------------------- 
lldb-dap debugging       | 6.0

## Swiftly Support

The extension supports toolchains managed by [swiftly](https://github.com/swiftlang/swiftly), the Swift toolchain installer and manager. For instructions on installing swiftly see the [installation instructions on Swift.org](https://www.swift.org/install).

You can choose a swiftly managed toolchain to use from the `> Swift: Select Toolchain` menu.

If you do `swiftly use` on the command line you must restart VS Code or do `> Developer: Reload Window` in order for the VS Code Swift extension to start using the new toolchain.

### `.swift-version` Support

Swiftly can use a special `.swift-version` file in the root of your package so that you can share your toolchain preference with the rest of your team. The VS Code Swift extension respects this file if it exists and will use the toolchain specified within it to build and test your package.

For more information on the `.swift-version` file see swiftly's documentation on [sharing recommended toolchain versions](https://swiftpackageindex.com/swiftlang/swiftly/main/documentation/swiftlydocs/use-toolchains#Sharing-recommended-toolchain-versions).
