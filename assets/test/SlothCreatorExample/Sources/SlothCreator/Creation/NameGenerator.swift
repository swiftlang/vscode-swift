/// A type that generates names for sloths.
public protocol NameGenerator {
    /// Generates a name for a sloth.
    ///
    /// - parameter seed: A value that influences randomness.
    func generateName(seed: Int) -> String
}
