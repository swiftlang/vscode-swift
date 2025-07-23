# Automatic Task Creation

Add tasks for common operations with your Package.

For workspaces that contain a `Package.swift` file, the Swift extension adds the following tasks:

- **Build All**: Build all targets in the Package.
- **Build Debug \<Executable\>**: Each executable product in a Package.swift get a task for building a debug build.
- **Build Release \<Executable\>**: Each executable product in a Package.swift get a task for building a release build.

> 💡 Tip: Tasks use workflows common to all VS Code extensions. For more information see [the VS Code documentation for tasks](https://code.visualstudio.com/docs/editor/tasks).

These tasks are available via the commands **Terminal ▸ Run Task...** and **Terminal ▸ Run Build Task...** in the command palette.

## Create tasks for library targets

By default build tasks are only automatically created for executable products. If you set the `swift.createTasksForLibraryProducts` setting to true, then additional tasks will be created:
- **Build Debug \<Library\>**: Each library product in a Package.swift get a task for building a debug build.
- **Build Release \<Library\>**: Each library product in a Package.swift get a task for building a release build.

> ⚠️ Important: Tasks will not be created for automatic library products, as you cannot specify a `--product` option for automatic products when building.