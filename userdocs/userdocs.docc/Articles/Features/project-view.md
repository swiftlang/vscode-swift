# Swift Project View

Use this view to navigate your Swift project.

If your workspace contains a package, this extension will add a **Swift Project** view to the Explorer:

![A snapshot of the Package Dependencies view showing dependencies for the async-http-client Swift project.](package-dependencies.png)

Additionally, the extension will monitor `Package.swift` and `Package.resolved` for changes, resolve any changes to the dependencies, and update the view as needed.
