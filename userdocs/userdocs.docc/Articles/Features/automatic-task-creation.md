# Automatic Task Creation

Tasks added for common operations with your Package.

> 💡 Tip: Tasks use workflows common to all VS Code extensions. For more information see [the VS Code documentation for tasks](https://code.visualstudio.com/docs/editor/tasks).

For workspaces that contain a **Package.swift** file, the Swift extension will add the following tasks:

- **Build All**: Build all targets in the Package
- **Build Debug <Executable>**: Each executable in a Package.swift get a task for building a debug build
- **Build Release <Executable>**: Each executable in a Package.swift get a task for building a release build

These tasks are available via the commands **Terminal ▸ Run Task...** and **Terminal ▸ Run Build Task...** in the command palette.
