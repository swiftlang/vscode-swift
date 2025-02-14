import PackagePlugin
import Foundation

@main
struct MyCommandPlugin: CommandPlugin {
    func performCommand(context: PluginContext, arguments: [String]) throws {
        print("Plugin Target Hello World")
    }
}