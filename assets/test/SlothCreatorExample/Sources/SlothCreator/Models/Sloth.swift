/*
See LICENSE folder for this sample’s licensing information.

Abstract:
The model type for a sloth.
*/

import Foundation

/// A model representing a sloth.
///
/// Sloths are mammals known for their slowness of movement. They spend most of their
/// lives hanging upside down in trees.
///
/// You can create a sloth using the ``init(name:color:power:)`` initializer, or
/// create a randomly generated sloth using a ``SlothGenerator``:
///
/// ```swift
/// let slothGenerator = MySlothGenerator(seed: randomSeed())
/// let habitat = Habitat(isHumid: false, isWarm: true)
/// do {
///     let sloth = try slothGenerator.generateSloth(in: habitat)
/// } catch {
///     fatalError(String(describing: error))
/// }
/// ```
public struct Sloth {
    
    /// The name of the sloth.
    public var name: String
    
    /// The color of the sloth.
    public var color: Color
    
    /// The power of the sloth.
    public var power: Power
    
    /// The energy level of the sloth.
    ///
    /// Sloths have a very low metabolic rate, so their energy level is often low as well. It's
    /// important to check their energy level often, and offer them food or opportunities to sleep
    /// before asking them to perform an activity or exercise.
    ///
    /// You can increase the sloth's energy level by asking them to
    /// ``eat(_:quantity:)`` or ``sleep(in:for:)``.
    public var energyLevel = 10
    
    /// The care schedule of the sloth.
    ///
    /// A care schedule maintains the health and happiness of the sloth.
    public var schedule = CareSchedule()
    
    /// Creates a sloth with the specified name and color.
    ///
    /// - Parameters:
    ///   - name: The name of the sloth.
    ///   - color: The color of the sloth.
    ///   - power: The power of the sloth.
    public init(name: String, color: Color, power: Power) {
        self.name = name
        self.color = color
        self.power = power
    }
    
    /// Eat the provided specialty sloth food.
    ///
    /// Sloths love to eat while they move very slowly through their rainforest habitats. They
    /// are especially happy to consume leaves and twigs, which they digest over long periods
    /// of time, mostly while they sleep.
    ///
    /// When they eat food, a sloth's ``energyLevel`` increases by the food's
    /// ``Food/energy``. You can feed a sloth any custom ``Food`` that you define
    /// yourself, or you can feed them one of the standard foods of ``Food/twig``,
    /// ``Food/largeLeaf``, or ``Food/regularLeaf``:
    ///
    /// ```swift
    /// sleepySloth.eat(.twig)
    ///
    /// let flower = Sloth.Food(name: "Flower Bud", energy: 10)
    /// superSloth.eat(flower)
    /// ```
    /// By default, the sloth eats one of the food items you provide, but you can also specify
    /// how many of the items the sloth should eat if you have an abundance to share with them:
    ///
    /// ```swift
    /// twigHappySloth.eat(.twig, quantity: 10)
    /// ```
    ///
    /// - Parameters:
    ///   - food: The food for the sloth to eat.
    ///   - quantity: The quantity of the food for the sloth to eat.
    /// - Returns: The sloth's energy level after eating.
    mutating public func eat(_ food: Food, quantity: Int = 1) -> Int {
        energyLevel += food.energy * quantity
        return energyLevel
    }
    
    /// Sleep in the specified habitat for a number of hours.
    ///
    /// Sloths need to sleep for a large number of hours each day because of their low metabolic
    /// rate. Each time the sloth sleeps, their ``energyLevel`` increases every hour by the
    /// habitat's ``Habitat/comfortLevel``.
    ///
    /// By default, the sloth sleeps for 12 hours:
    ///
    /// ```swift
    /// tiredSloth.sleep(in: lovelyHabitat)
    /// ```
    ///
    /// You can also specify a custom number of hours:
    ///
    /// ```swift
    /// nearlyAwakeSloth.sleep(in: lovelyHabitat, for: 3)
    /// ```
    ///
    /// - Parameters:
    ///   - habitat: The location for the sloth to sleep.
    ///   - numberOfHours: The number of hours for the sloth to sleep.
    /// - Returns: The sloth's energy level after sleeping.
    mutating public func sleep(in habitat: Habitat, for numberOfHours: Int = 12) -> Int {
        energyLevel += habitat.comfortLevel * numberOfHours
        return energyLevel
    }
}

