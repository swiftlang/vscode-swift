# Playgrounds

@Metadata {
    @Available("Swift", introduced: "6.3")
}

Interact with the #Playground macro usages in your project.


The Swift Package Manager provides a `swift play` subcommand, which compiles the various playgrounds for your Swift package that are defined using the #Playground macro. Using this subcommand, you can list all the playgrounds in your project or specify one playground to run.

```
$ swift play --list
Build of product 'MyPlaygroundsLibrary__Playgrounds' complete! (2.88s)
Found 2 Playgrounds
* MyPlaygroundsLibrary/MyPlaygroundsLibrary.swift:10 foo
* MyPlaygroundsLibrary/MyPlaygroundsLibrary.swift:21 bar
```

```
$ swift play bar
```

This workflow of finding and running playgrounds for your Swift package has been simplified by the Swift Extension for VS Code. First, all the playgrounds for the workspace are listed under the <doc:project-view>:

![Playgrounds for the workspace listed in the project view.](playgrounds-project-panel.png)

Each listed playground will be labelled with the optional name, or using the unique ID if the playground is unnamed. Clicking on one of the playgrounds will open an editor and highlght where the playground is defined:

![Playground opened and highlighted in the editor.](playground-clicked.png)

You can also press the play button for each listed playground to run that playground:

![Playground run from project panel.](project-panel-play.png)

The editor provides clickable CodeLens which provide another means to run the playground:

![Playground run from CodeLens.](playground-codelens.png)

> Note: This set of features are only available when using a Swift toolchain 6.3 or higher.

