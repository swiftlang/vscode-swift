# Language Features

Language features to help you write Swift code.

The Swift extension provides language features such as code completion and jump to definition via [SourceKit-LSP](https://github.com/apple/sourcekit-lsp). To ensure the extension functions correctly, it’s important to first build the project so that SourceKit-LSP has access to all the symbol data. Whenever you add a new dependency to your project, make sure to rebuild it so that SourceKit-LSP can update its information.