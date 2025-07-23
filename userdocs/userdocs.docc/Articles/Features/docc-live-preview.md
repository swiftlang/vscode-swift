# Documentation Live Preview

@Metadata {
    @Available("Swift", introduced: "6.2")
}

Show a live preview of your Swift documentation while editing.


The Swift toolchain provides DocC, which compiles documentation for your Swift package. You can distribute compiled documentation to developers, or host the content. It's what this project used to make its documentation! You can learn more about DocC by reading [the documentation on the Swift organization's website](https://www.swift.org/documentation/docc/).

View a side-by-side live preview of your documentation as you edit it with the Swift extension for VS Code.
Access this feature using the Preview Swift Documentation button at the top right of an editor, or by invoking `Swift: Preview Documentation` in the command palette.

This opens up a new editor pane with your rendered documentation:

![An animation showing how to launch documentation live preview.](docc-live-preview.gif)

> Note: This feature is only available when using a Swift toolchain 6.2 or higher running on macOS or Linux.

