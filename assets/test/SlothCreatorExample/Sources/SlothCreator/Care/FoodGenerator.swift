/// A type that generates food.
///
/// ## Topics
///
/// ### Generating Food
///
/// - ``generateFood(in:)``
public protocol FoodGenerator {
    /// Generates a piece of food in the specified habitat.
    func generateFood(in habitat: Habitat) -> Sloth.Food
}
