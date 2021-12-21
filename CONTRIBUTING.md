# Contributing

## Conduct

All contributors are expected to adhere to the project's [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

To begin development on the VSCode extension for Swift you will need to install [Node.js](https://nodejs.org). On Linux, make sure to install Node.js from its official website or from [NodeSource](https://github.com/nodesource/distributions/) as the version included with your Linux distribution may be outdated.

Next, clone this repository, enter the cloned folder and run `npm install` to install all the dependencies.

When you first open the project in VSCode you will be recommended to also install `ESLint` and `Prettier - Code formatter`. Please do so. We use these to ensure a consistent style and expect everyone who contributes to follow this style as well. 

To run your version of the Swift extension while in VSCode, press `F5`. This will open up another instance of VSCode with it running. You can use the original version of VSCode to debug it. 

## Submitting a bug or issue

Please ensure to include the following in your bug report:
- A consise description of the issue, what happened and what you expected.
- Simple reproduction steps
- Version of the extension you are using
- Contextual information (Platform, Swift version etc)

## Submitting a Pull Request

Please ensure to include the following in your Pull Request:
- A description of what you are trying to do. What the PR provides to the library, additional functionality, fixing a bug etc
- A description of the code changes
- Documentation on how these changes are being tested
- Additional tests to show your code working and to ensure future changes don't break your code.

Please keep your PRs to a minimal number of changes. If a PR is large, try to split it up into smaller PRs. Don't move code around unnecessarily as it makes comparing old with new very hard. If you have plans for a large change please talk to the maintainers of the project beforehand. There is a `#vscode-swift` channel on the Swift Server Slack. You can [join here](https://join.slack.com/t/swift-server/shared_invite/zt-5jv0mzlu-1HnA~7cpjL6IfmZqd~yQ2A).

## Legal
By submitting a pull request, you represent that you have the right to license your contribution to the community, and agree by submitting the patch that your contributions are licensed under the Apache 2.0 license (see [LICENSE](LICENSE)).
