# Language Features

Language features to help you write Swift code.

> 💡 Tip: Language features are common to all VS Code extensions. See the [VS Code documentation about navigating code](https://code.visualstudio.com/docs/editing/editingevolved) for a more in-depth overview.

The Swift extension provides language features such as code completion and jump to definition via [SourceKit-LSP](https://github.com/apple/sourcekit-lsp).

> ⚠️ Important: With Swift toolchains prior to 6.1 you will need to build your project at least once for SourceKit-LSP to function correcly. Whenever you add a new dependency to your project, make sure to rebuild it so that SourceKit-LSP can update its information.

SourceKit-LSP provides background indexing in Swift toolchain 6.1 which will automatically index your project on startup. All indexing results are cached in the `.build/index-build` folder within your workspace.

SourceKit-LSP can be configured via extension settings. See <doc:settings> for more information.
