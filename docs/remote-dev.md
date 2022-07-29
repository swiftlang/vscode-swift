# Visual Studio Code Remote Development

[VSCode Remote Development](https://code.visualstudio.com/docs/remote/containers) allows you to run your code and environment in a container. This is especially useful for Swift when developing on macOS and deploying to Linux. You can ensure there are no compatibility issues in Foundation when running your code. The extension also works with [GitHub Codespaces](https://github.com/features/codespaces) to allow you to write your code on the web.

## Requirements

As well as installing the Swift extension, you must install Docker on your machine to run the remote container in. See the [Visual Studio Code documentation](https://code.visualstudio.com/docs/remote/containers) for more details.

Next, install the [Remote Development extension pack](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack) that contains extensions for working in remote environments in VSCode. If you only want to work with remote containers (and not use the SSH or WSL containers), you may want to only install the [Remote Development Container extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) instead.

## Running in a container

### Manual Setup

VSCode requires a `.devcontainer` directory which defines the settings in `devcontainer.json` and optionally a `Dockerfile` defining the container to run in.

First create the directory. Next, create `devcontainer.json` and insert the following:

```json
{
    "name": "Swift 5.5",
    "image": "swift:5.5",
    "extensions": [
      "sswg.swift-lang"
    ],
    "settings": {
      "lldb.library": "/usr/lib/liblldb.so"
    },
    "forwardPorts": [8080]
}
```

This defines the minimum settings required to run a Swift package in a remote container. Here's what each thing does:

* `name`: Used to specify the name of the remote container.
* `image`: The Docker container image to run. You can choose whichever version of Swift you like, including [nightlies](https://hub.docker.com/r/swiftlang/swift).
* `extensions`: Extensions to install in your remote environment. You do not need to specify extensions' dependencies, such as LLDB.
* `settings`: Override any settings for extensions. The above example sets the LLDB path to stop the Swift extension from attempting to set it up.
* `forwardPorts`: Ports to enable forwarding for. You may want to include this if building a Swift server application for example.

That's all you need to get a dev container working!

#### Using a custom Dockerfile

You may want to use a custom Docker container that's version controlled to make it easy to set up a development environment for you team. In `devcontainer.json` replace `image` with the following:

```json
{
    "build": { "dockerfile": "Dockerfile" },
    // ...
}
```

This will use the `Dockerfile` provided in `.devcontainer`. Create that file and insert your custom Dockerfile. For example:

```docker
FROM swift:5.5
```

### Using a custom Docker Compose File

For more complex development environments you may need to use Docker Compose. The `devcontainer.json` file has three settings you need to include if you want to use Docker Compose: 
- `dockerComposeFile` your docker compose file
- `service` the service you want to run
- `workspaceFolder` the root folder for your project

Your `devcontainer.json` should look something like this

```json
{
    "name": "MyService: 5.6-focal",
    "dockerComposeFile": "docker-compose.yml",
    "service": "app",
    "workspaceFolder": "/workspace",
    "extensions": [
      "sswg.swift-lang",
    ],
    "settings": {
      "lldb.library": "/usr/lib/liblldb.so"
    },
}
```

Below is an example of a `docker-compose.yml` file that brings up a redis server

```yaml
version: "3.3"

services:
  app:
    image: swift:5.6-focal
    volumes:
      - ..:/workspace
    depends_on:
      - redis
    environment:
      - REDIS_HOST=redis
    command: sleep infinity

  redis:
    image: redis
    ports:
      - "6379:6379"
```

Note the `service` and `workspace` variables from the `devcontainer.json` reference the service `app` and workspace volume in the `docker-compose.yml`. The `app` service is required to run all the time you are using the devcontainer. We do this here by using the command `sleep infinity`. It is dependent on the `redis` service which can be referenced in code using the service name `redis`. I have also included a `REDIS_HOST` environment variable which can be used in your code.

### Automatic Setup

VSCode allows you to automatically configure your project with a dev container. In the command palette (`F1`) choose **Remote-Containers: Add Development Container Configuration Files...** and choose Swift.

### Running in a container

Once you've set up your `.devcontainer`, in the command palette run **Remote-Containers: Reopen in Container**. VSCode will relaunch running in your remote container!

For more details about running your project in a remote container, and the available configuration options, see the [Visual Studio Code documentation](https://code.visualstudio.com/docs/remote/remote-overview).
