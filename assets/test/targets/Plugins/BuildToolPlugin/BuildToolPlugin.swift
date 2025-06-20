import PackagePlugin
import Foundation

@main
struct SimpleBuildToolPlugin: BuildToolPlugin {
    func createBuildCommands(context: PluginContext, target: Target) async throws -> [Command] {
        guard let sourceFiles = target.sourceModule?.sourceFiles else { return [] }

        // Build tool plugins are not being called on Windows with Swift < 6.0.
        #if os(Windows) && !compiler(>=6.0)
        return []
        #endif

        let generatorTool = try context.tool(named: "ExecutableTarget")

        // Construct a build command for each source file with a particular suffix.
        return sourceFiles.map(\.path).compactMap {
            createBuildCommand(
                for: $0,
                in: context.pluginWorkDirectory,
                with: generatorTool.path
            )
        }
    }

    /// Calls a build tool that transforms JSON files into Swift files.
    func createBuildCommand(for inputPath: Path, in outputDirectoryPath: Path, with generatorToolPath: Path) -> Command? {
        let inputURL = URL(fileURLWithPath: inputPath.string)
        let outputDirectoryURL = URL(fileURLWithPath: outputDirectoryPath.string)

        // Skip any file that doesn't have the extension we're looking for (replace this with the actual one).
        guard inputURL.pathExtension == "json" else { return .none }

        // Produces .swift files in the same directory structure as the input JSON files appear in the target.
        let components = inputURL.absoluteString.split(separator: "LibraryTarget", omittingEmptySubsequences: false).map(String.init)
        let inputName = inputURL.lastPathComponent
        let outputDir = outputDirectoryURL.appendingPathComponent(components[1]).deletingLastPathComponent()
        let outputName = inputURL.deletingPathExtension().lastPathComponent + ".swift"
        let outputURL = outputDir.appendingPathComponent(outputName)

        return .buildCommand(
            displayName: "Generating \(outputName) from \(inputName)",
            executable: generatorToolPath,
            arguments: ["\(inputPath)", "\(outputURL.path)"],
            inputFiles: [inputPath],
            outputFiles: [Path(outputURL.path)]
        )
    }
}
