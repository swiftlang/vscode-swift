# Extension Settings

The Visual Studio Code Swift extension comes with a number of settings you can use to control how it works. Detailed descriptions of each setting is provided in the extension settings page.

This document outlines useful configuration options not covered by the settings descriptions in the extension settings page.

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
