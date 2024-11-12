/// A type that generates sloths.
public protocol SlothGenerator {
    /// Generates a sloth in the specified habitat.
    func generateSloth(in habitat: Habitat) throws -> Sloth
}
