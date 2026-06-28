# Automatic Task Creation

Add tasks for common operations with your Package.

For workspaces that contain a `Package.swift` file, the Swift extension adds the following tasks:

- **Build All**: Build all targets in the Package.
- **Build Debug \<Executable\>**: Each executable product in a Package.swift get a task for building a debug build.
- **Build Release \<Executable\>**: Each executable product in a Package.swift get a task for building a release build.
- **Clean Build Folder**: Runs `swift package clean` to remove all build artifacts.

> 💡 Tip: Tasks use workflows common to all VS Code extensions. For more information see [the VS Code documentation for tasks](https://code.visualstudio.com/docs/editor/tasks).

These tasks are available via the commands **Terminal ▸ Run Task...** and **Terminal ▸ Run Build Task...** in the command palette.

## Create tasks for library targets

By default build tasks are only automatically created for executable products. If you set the `swift.createTasksForLibraryProducts` setting to true, then additional tasks will be created:
- **Build Debug \<Library\>**: Each library product in a Package.swift get a task for building a debug build.
- **Build Release \<Library\>**: Each library product in a Package.swift get a task for building a release build.

> ⚠️ Important: Tasks will not be created for automatic library products, as you cannot specify a `--product` option for automatic products when building. For more information see the [Swift Package Manager documentation for Product definitions](https://docs.swift.org/package-manager/PackageDescription/PackageDescription.html#product).

## Combining tasks

You can compose multiple built-in Swift tasks into a single [compound task](https://code.visualstudio.com/docs/debugtest/tasks#_compound-tasks) in your `.vscode/tasks.json`. For example, you can create a `Clean Rebuild` compound task that runs the `swift: Clean Build Folder` task followed by the `swift: Build All` task:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Clean Rebuild",
            "dependsOn": ["swift: Clean Build Folder", "swift: Build All"],
            "dependsOrder": "sequence",
            "group": "build"
        }
    ]
}
```

[VS Code Debug Configurations](https://code.visualstudio.com/docs/debugtest/debugging-configuration) have a `preLaunchTask` property that can be used to run a single task before launching the debugger. You can use a compound task to run multiple smaller tasks as a `preLaunchTask`. For example, if you add the following to your `.vscode/launch.json`, VS Code will run the `Clean Rebuild` compound task before launching the debugger:

```json
{
    "configurations": [
        {
            "type": "swift",
            "request": "launch",
            "name": "Launch MyApp",
            "target": "MyApp",
            "preLaunchTask": "Clean Rebuild"
        }
    ]
}
```

