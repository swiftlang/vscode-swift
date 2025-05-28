# Automatic Task Creation

vscode-swift automatically adds tasks for common operations with your Package.

> Tip: Tasks use workflows common to all VSCode extensions. For more information see https://code.visualstudio.com/docs/editor/tasks

For workspaces that contain a **Package.swift** file, this extension will add the following tasks:

- **Build All**: Build all targets in the Package
- **Build Debug <Executable>**: Each executable in a Package.swift get a task for building a debug build
- **Build Release <Executable>**: Each executable in a Package.swift get a task for building a release build

These tasks are available via **Terminal ▸ Run Task...** and **Terminal ▸ Run Build Task...**.