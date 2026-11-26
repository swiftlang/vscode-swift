# Supported Toolchains

Find out which versions of Swift the extension supports.

The Swift extension supports the following Swift toolchains:
 * 5.9
 * 5.10
 * 6.0
 * 6.1
 * 6.2

The extension also strives to work with the latest nightly toolchains built from the main branch.

Certain features of the Swift extension will only work with newer versions of the toolchains. We recommend using the latest version of the Swift toolchain to get the most benefit out of the extension. The following features only work with certain toolchains as listed:

Feature                    | Minimum Toolchain Required
-------------------------- | ------------------------------------- 
Debugging with `lldb-dap`  | 6.0
<doc:docc-live-preview>    | 6.2

## Toolchain Management

The Swift extension automatically detects installations of the Swift toolchain in your environment. It looks for a `swift` binary available in `PATH` and, if one cannot be found, prompts you to [install a toolchain from Swift.org](https://www.swift.org/install).

<div class="warning" markdown="1">
If you install a toolchain or Swiftly while VS Code is open, fully quit VS Code and then reopen it. This makes sure the extension host gets the updated PATH so that extension can find the toolchain. Executing the `Developer: Reload Window` command is not enough.
</div>

If you have multiple Swift toolchains installed on your system, use the command `Swift: Select Toolchain...` to tell the extension which toolchain to use. The command shows you a list of all the toolchains that VS Code found on your system and lets you switch between them.

@Video(
    source: "toolchain-selection.mp4",
    alt: "A video showing a VS Code window. The command palette is opened to run the 'Swift: Select Toolchain...' command which is then used to select Xcode as the preferred toolchain.",
    poster: "toolchain-selection.png"
)

## Swiftly Support

The extension supports toolchains managed by [swiftly](https://github.com/swiftlang/swiftly), the Swift toolchain installer and manager. This is the recommended way of installing Swift toolchains on macOS and Linux. For instructions on installing swiftly see the [installation instructions on Swift.org](https://www.swift.org/install). There is also a [getting started guide for swiftly on Swift.org](https://www.swift.org/swiftly/documentation/swiftly/getting-started/).

Choose a swiftly managed toolchain to use from the `> Swift: Select Toolchain...` menu.

If you do `swiftly use` on the command line you must restart VS Code or do `> Developer: Reload Window` in order for the VS Code Swift extension to start using the new toolchain.

### Installing Toolchains

The Swift extension can use swiftly to install toolchains on your behalf. This allows you to discover, install, and configure Swift toolchains directly from the VS Code interface without needing to use the command line.

Before using the toolchain installation feature, ensure you meet the following requirements:

* **Swiftly 1.1.0 or newer** - The installation feature requires swiftly version 1.1.0 or newer. Run **`swiftly self-update`** in your terminal to get the latest version of swiftly.
* **Administrator Privileges** - On Linux systems, `sudo` may be required to install system dependencies for the toolchain after installation.

You can access the installation commands via the `Swift: Select Toolchain...` command, or by running the following commands directly:
- **`Swift: Install Swiftly Toolchain...`** - installs stable Swift toolchains via swiftly
- **`Swift: Install Swiftly Snapshot Toolchain...`** - installs snapshot Swift toolchains via swiftly

### .swift-version Support

Swiftly can use a special `.swift-version` file in the root of your package so that you can share your toolchain preference with the rest of your team. The VS Code Swift extension respects this file if it exists and will use the toolchain specified within it to build and test your package.

For more information on the `.swift-version` file see swiftly's documentation on [sharing recommended toolchain versions](https://swiftpackageindex.com/swiftlang/swiftly/main/documentation/swiftlydocs/use-toolchains#Sharing-recommended-toolchain-versions).
