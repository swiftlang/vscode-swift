import PackagePlugin

@main
struct SimpleBuildToolPlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target: Target) async throws -> [Command] {
        guard let sourceFiles = target.sourceModule?.sourceFiles else { return [] }

        let generatorTool = try context.tool(named: "ExecutableTarget")

        // Construct a build command for each source file with a particular suffix.
        return sourceFiles.map(\.path).compactMap {
            createBuildCommand(for: $0, in: context.pluginWorkDirectory, with: generatorTool.path)
        }
    }

    /// Calls a build tool that transforms JSON files into Swift files.
    func createBuildCommand(for inputPath: Path, in outputDirectoryPath: Path, with generatorToolPath: Path) -> Command? {
        // Skip any file that doesn't have the extension we're looking for (replace this with the actual one).
        guard inputPath.extension == "json" else { return .none }

        // Produces .swift files in the same directory structure as the input JSON files appear in the target.
        let components = inputPath.string.split(separator: "LibraryTarget", omittingEmptySubsequences: false).map(String.init)
        let inputName = inputPath.lastComponent
        let outputDir = outputDirectoryPath.appending(components[1]).removingLastComponent()
        let outputName = inputPath.stem + ".swift"
        let outputPath = outputDir.appending(outputName)

        return .buildCommand(
            displayName: "Generating \(outputName) from \(inputName)",
            executable: generatorToolPath,
            arguments: ["\(inputPath)", "\(outputPath)"],
            inputFiles: [inputPath],
            outputFiles: [outputPath]
        )
    }
}
