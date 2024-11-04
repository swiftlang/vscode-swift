/*
See LICENSE folder for this sample’s licensing information.

Abstract:
The model type for the foods sloths eat.
*/

import Foundation

extension Sloth {
    /// Food that a sloth can consume.
    ///
    /// Sloths love to eat the leaves and twigs they find in the rainforest canopy as they
    /// slowly move around. To feed them these items, you can use the ``twig``,
    /// ``regularLeaf`` and ``largeLeaf`` default foods.
    ///
    /// ```swift
    /// superSloth.eat(.twig)
    /// ```
    ///
    /// You can also define your own custom sloth food by providing a name and the
    /// energy level. When the sloth eats your custom food, their energy level increases
    /// by the ``energy`` of the food:
    ///
    /// ```swift
    /// let flower = Sloth.Food(name: "Flower Bud", energy: 10)
    /// superSloth.eat(flower)
    /// ```
    public struct Food {
        /// The name of the food.
        public let name: String
        
        /// The amount of energy the food contains.
        ///
        /// When sloths metabolize the food they eat, their ``Sloth/energyLevel``
        /// increases by the amount of energy the food contains.
        public let energy: Int
        
        /// Creates food with the specified name and energy level.
        /// - Parameters:
        ///   - name: The name of the food.
        ///   - energy: The amount of energy the food contains.
        public init(name: String, energy: Int) {
            self.name = name
            self.energy = energy
        }
    }
}

extension Sloth.Food {
    /// A spindly stick.
    public static let twig = Sloth.Food(name: "Twig", energy: 1)
    
    /// A regular-sized leaf.
    public static let regularLeaf = Sloth.Food(name: "Regular Leaf", energy: 2)
    
    /// A large leaf.
    public static let largeLeaf = Sloth.Food(name: "Large Leaf", energy: 5)
}

