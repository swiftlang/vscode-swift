#if !os(Windows)
import Foundation

@main
struct CodeGenerator {
    static func main() async throws {
        // Use swift-argument-parser or just CommandLine, here we just imply that 2 paths are passed in: input and output
        guard CommandLine.arguments.count == 3 else {
            throw CodeGeneratorError.invalidArguments
        }
        // arguments[0] is the path to this command line tool
        guard let input = URL(string: "file://\(CommandLine.arguments[1])"), let output = URL(string: "file://\(CommandLine.arguments[2])") else {
            return
        }
        let jsonData = try Data(contentsOf: input)
        let enumFormat = try JSONDecoder().decode(JSONFormat.self, from: jsonData)

        let code = """
        enum \(enumFormat.name): CaseIterable {
        \t\(enumFormat.cases.map({ "case \($0)" }).joined(separator: "\n\t"))
        }
        """
        guard let data = code.data(using: .utf8) else {
            throw CodeGeneratorError.invalidData
        }
        try data.write(to: output, options: .atomic)
    }
}

struct JSONFormat: Decodable {
    let name: String
    let cases: [String]
}

enum CodeGeneratorError: Error {
    case invalidArguments
    case invalidData
}
#else
@main
struct DummyMain {
    static func main() {
    }
}
#endif