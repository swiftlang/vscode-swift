# Swift for Visual Studio Code test strategy

This document covers the structure of tests as well as plans for the future. For a more in depth explanation of how to write and structure tests for your contributions, please see the [Writing Tests for VS Code Swift](./writing-tests-for-vscode-swift.md) document in this repository.

The recommended way for [testing extensions](https://code.visualstudio.com/api/working-with-extensions/testing-extension) involves using either the new [vscode-test-cli](https://github.com/microsoft/vscode-test-cli) or creating your [own mocha test runner](https://code.visualstudio.com/api/working-with-extensions/testing-extension#advanced-setup-your-own-runner). Either approach results in Visual Studio Code getting downloaded, and a window spawned. This is necessary to have access the the APIs of the `vscode` namespace, to stimulate behaviour (ex. `vscode.tasks.executeTasks`) and obtain state (ex. `vscode.languages.getDiagnostics`).

There are some testing gaps when only using this approach. Relying on using the `vscode` APIs makes it difficult to easily write unit tests. It ends up testing the communication between a lot of components in the `vscode-swift` extension and associated dependencies. Additionally, there is a lot of code that remains unverified. This code may get executed so that it shows up in the coverage report, but the behaviour is unobserved. Some examples of behaviour that is not observed, includes prompting the user for input, or verifying if a notification gets shown. See https://devblogs.microsoft.com/ise/testing-vscode-extensions-with-typescript/ for a more detailed overview.

In addition to gaps in testing, the current approach tests at the integration level which results in slower and more brittle tests, as they rely on the communication between several components.

## Test Pyramid

Tests are grouped into 3 levels. The biggest distinguishing factors between the various levels will be the runtime of the test, and the number of "real" vs. mocked dependencies.

### 1. Unit (`/test/unit`)

- Employ stubbing or mocking techniques to allow for user interaction, AND to mock slow APIs like `executeTask`
- Mocked SwiftPM commands return hardcoded output, such as compile errors
- Any sourcekit-lsp interaction is mocked, with hardcoded responses
- Runs with a fast timeout of 100ms
- No usages of assets/test projects
  - Use [mock-fs](https://www.npmjs.com/package/mock-fs) for testing fs usage
- Run in CI build for new PRs
- Ideally the vast majority of tests are at this level

### 2. Integration (`/test/integration`)

- Tests interaction between components, with some mocking for slow or fragile dependencies
- Stimulate actions using the VS Code APIs
- Use actual output from SwiftPM
- Use actual responses from sourcekit-lsp
- Use a moderate maximum timeout of up to 30s
  - The CI job timeout is 15 minutes
- Use curated `assets/test` projects
- Run in CI and nightly builds
- Test key integrations with the VS Code API and key communication between our components

### 3. Smoke (`/test/smoke`)

- No mocking at all
- For now only stimulate actions using the VS Code APIs, testing via the UI is a different beast
- Use curated `assets/test` projects
- No need to enforce a maximum timeout (per test)
- Only run in nightly build
- Should only have a handful of these tests, for complex features

## Test Matrix

### CI Build

- Run for new PRs (`@swift-server-bot test this please`)
- Run macOS, Linux and Windows
  - Currently only Linux, macOS and Windows is being explored
  - Expect Windows to fail short term, annotate to disable these tests
- Ideally run against Swift versions 5.6 - 6.0 + main
- Run `unit` and `integration` test suites
- Run test against latest `stable` VS Code

### Nightly Build

- Run macOS, Linux and Windows
  - Currently only Linux, macOS and Windows is being explored
- Ideally run against Swift versions 5.6 - 6.0 + main
- Run `integration` and `smoke` test suites
- Run test against latest `stable` and `insiders` VS Code
