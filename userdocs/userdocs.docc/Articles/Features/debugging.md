# Debugging

Debug your Swift executables using LLDB.

When you open a Swift package (a directory containing a `Package.swift` file), the extension automatically generates build tasks and launch configurations for each executable within the package. Additionally, if the package includes tests, the extension creates a configuration specifically designed to run those tests. These configurations all leverage the CodeLLDB extension as the debugger of choice.

> 💡 Tip: Debugging workflows are common to all VS Code extensions. See the [VS Code documentation about testing](https://code.visualstudio.com/docs/debugtest/testing) for a more in-depth overview.
>
> Debugging works best when using a version of the Swift toolchain 6.0 or higher.

Use the **Run > Start Debugging** menu item to run an executable and start debugging. If you have multiple launch configurations you can choose which launch configuration to use in the debugger view.

## Launch Configurations

The Swift extension will automatically generate launch configurations for all of your executable products. You can customize these configurations via the `.vscode/launch.json` file in your workspace to add environment variables, arguments, etc.

Each generated launch configuration will have the `"type"` set to `"swift"`. The properties for the swift launch configuration match the ones [provided by `lldb-dap`](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.lldb-dap). You can use code completion in VS Code to help with adding properties to your launch configuration.

### Launching an Executable

The most basic launch configuration uses the `"launch"` request and provides a program that will be debugged. For example:

```javascript
{
    "label": "Debug my-executable", // Human readable name for the configuration
    "type": "swift",                // All Swift launch configurations use the same type
    "request": "launch",            // Launch an executable
    "program": "${workspaceFolder}/.build/debug/my-executable"
}
```

There are many more options that you can specify which will alter the behavior of the debugger:

| Parameter                     | Type        | Description         |
|-------------------------------|-------------|---------------------|
| program                       | string      | Path to the executable to launch.
| args                          | [string]    | An array of command line argument strings to be passed to the program being launched.
| cwd                           | string      | The program working directory.
| env                           | dictionary  | Environment variables to set when launching the program. The format of each environment variable string is "VAR=VALUE" for environment variables with values or just "VAR" for environment variables with no values.
| stopOnEntry                   | boolean     | Whether to stop program immediately after launching.
| runInTerminal                 | boolean     | Launch the program inside an integrated terminal in the IDE. Useful for debugging interactive command line programs.
| initCommands                  | [string]    | Initialization commands executed upon debugger startup.
| preRunCommands                | [string]    | Commands executed just before the program is launched.
| postRunCommands               | [string]    | Commands executed just as soon as the program is successfully launched when it's in a stopped state prior to any automatic continuation.
| launchCommands                | [string]    | Custom commands that are executed instead of launching a process. A target will be created with the launch arguments prior to executing these commands. The commands may optionally create a new target and must perform a launch. A valid process must exist after these commands complete or the \"launch\" will fail. Launch the process with \"process launch -s\" to make the process to at the entry point since lldb-dap will auto resume if necessary.
| stopCommands                  | [string]    | Commands executed each time the program stops.
| exitCommands                  | [string]    | Commands executed when the program exits.
| terminateCommands             | [string]    | Commands executed when the debugging session ends.

### Attaching to a Process

You can attach to an existing process by using the `"attach"` request and providing one or both of a `"program"` or `"pid"` to attach to:

```javascript
{
    "label": "Debug my-executable", // Human readable name for the configuration
    "type": "swift",                // All Swift launch configurations use the same type
    "request": "attach",            // Attach to a process
    "program": "${workspaceFolder}/.build/debug/my-executable",
    "pid": "${command:pickProcess}"
}
```

The options for attach requests are mostly the same as the launch request with the addition of the following:

| Parameter          | Type        | Description         |
|--------------------|-------------|---------------------|
| program            | string      | Path to the executable to attach to. This value is optional but can help to resolve breakpoints prior the attaching to the program.
| pid                | number      | The process id of the process you wish to attach to. If `pid` is omitted, the debugger will attempt to attach to the program by finding a process whose file name matches the file name from `program`. Setting this value to `${command:pickMyProcess}` will allow interactive process selection in the IDE.
| waitFor            | boolean     | Wait for the process to launch.
| attachCommands     | [string]    | LLDB commands that will be executed after `preRunCommands` which take place of the code that normally does the attach. The commands can create a new target and attach or launch it however desired. This allows custom launch and attach configurations. Core files can use `target create --core /path/to/core` to attach to core files.