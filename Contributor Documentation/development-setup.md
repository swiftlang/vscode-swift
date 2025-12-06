# Development Setup

## Install Node.js / NPM
To begin development on the VS Code extension for Swift you will need to install [Node.js](https://nodejs.org). We use [nvm](https://github.com/nvm-sh/nvm) the Node version manager to install Node.js. To install or update nvm you should run their install script
```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```
More details on nvm installation can be found in the [README](https://github.com/nvm-sh/nvm/?tab=readme-ov-file) from its GitHub repository.

Once you have installed nvm, you can clone and configure the repository.

```sh
git clone https://github.com/swiftlang/vscode-swift.git && cd vscode-swift
```

Install the correct version of Node.JS for developing the extension

```sh
nvm install
```

Installs all the dependencies the extension requires

```sh
npm ci
```

## Install Development Extensions

When you first open the project in VS Code you will be recommended to also install [`ESLint`](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) and [`Prettier - Code formatter`](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode). Please do so. `ESLint`, `Prettier - Code formatter` is used to ensure a consistent style and we expect everyone who contributes to follow this style as well.

## Run / Debug Extension

To run your version of the Swift extension while in VS Code, press `F5` or run the `Run Extension` launch configuration. This will open up another instance of VS Code with it running. You can use the original version of VS Code to debug it.

## Linting

If you're developing in VS Code, once you [Install Development Extensions](#install-development-extensions) you should automatically have linting happen in the editor as you type, but you can also run from the command line:

```
npm run lint
```

## Formatting

If you're developing in VS Code, once you [Install Development Extensions](#install-development-extensions) you should automatically have formatting happen in the editor on save, but you can also run from the command line:

```bash
npm run format # Check formatting errors
```

```bash
npm run format -- --write # Fix any formatting errors
```

## Installing Pre-Release Builds

If you'd like to try out a change during your day to day work that has not yet been released to the VS Code Marketplace you can build and install your own `.vsix` package from this repository.

## Building

Make sure you have run `npm ci` so you have the latest dependencies and version of [vsce](https://www.npmjs.com/package/@vscode/vsce) which bundles the VSIX extension bundle that gets published. We can generate the `.vsix` package:

```sh
npm run dev-package
```

This builds a file that looks like `swift-vscode-[version]-dev.vsix`. Now install the extension with:

```sh
code --install-extension swift-vscode-[version]-dev.vsix
```

Alternatively you can install the extension from the Extensions panel by clicking the `...` button at the top of the panel and choosing `Install from VSIX...`.

If you'd like to return to using the released version of the extension you can uninstall then reinstall Swift for VS Code from the Extensions panel.

### Pre-Release Builds on the Marketplace

Occasionally, pre-release builds will be published to the VS Code Marketplace. These are produced automatically as part of our [nightly build](https://github.com/swiftlang/vscode-swift/actions/workflows/nightly.yml). To build a pre-release VSIX at desk, run `npm run preview-package`.

You can switch to the pre-release version by clicking on the `Switch to Pre-Release Version` button in the Extensions View:

![A snapshot of VS Code that has Extensions highlighted, showing the Swift extension. In the detail panel of the extension view, a red box highlights the button "Switch to Pre-Release Version".](userdocs/userdocs.docc/Resources/install-pre-release.png)

### Release Builds

These are produced automatically as part of our [nightly build](https://github.com/swiftlang/vscode-swift/actions/workflows/nightly.yml), but to set the VSIX builld at desk, run `npm run package`.

If you are currently on the pre-release train, switching back to the release version can be done by clicking on the `Switch to Release Version` button.

## Testing

> [!NOTE]
> For a detailed guide on how to write tests for the VS Code Swift extension, see [the guide about writing tests for the VS Code Swift extension](./writing-tests-for-vscode-swift.md).

Where possible any new feature should have tests that go along with it, to ensure it works and will continue to work in the future. When a PR is submitted one of the prerequisites for it to be merged is that all tests pass.

For information on levels of testing done in this extension, see the [test strategy](Contributor Documentation/test-strategy.md).

To get started running tests first import the `testing-debug.code-profile` VS Code profile used by the tests. Run the `> Profiles: Import Profile...` command then `Select File` and pick `./.vscode/testing-debug.code-profile`.

Now you can run tests locally using either of the following methods:

- From VS Code, by selecting `Extension Tests` in the Run and Debug activity.
- Using `npm run test` from your terminal
  - You can also use `npm run unit-test` or `npm run integration-test` to specifically run the Unit Tests or Integration Tests respectively.

Tests can also be launched from the terminal with the `--coverage` flag to display coverage information. For example:

```bash
npm run unit-test -- --coverage
```

## sourcekit-lsp

The VS Code extension for Swift relies on [sourcekit-lsp](https://github.com/swiftlang/sourcekit-lsp) for syntax highlighting, enumerating tests, and more. If you want to test the extension with a different version of the sourcekit-lsp you can add a `swift.sourcekit-lsp.serverPath` entry in your local `settings.json` to point to your sourcekit-lsp binary. The setting is no longer visible in the UI because it has been deprecated.

> [!WARNING]
> If your sourcekit-lsp version does not match your toolchain you may experience unexpected behaviour.
