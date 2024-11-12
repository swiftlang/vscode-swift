/*
See LICENSE folder for this sample’s licensing information.

Abstract:
The model type for the habitat where sloths live.
*/

/// The habitat where sloths live.
///
/// Sloths love hanging out in rain forests, and are especially grateful for hot and humid habitats.
/// They spend much of their time asleep, so make sure the habitats you create provide
/// comfortable and reliable branches in a large number of trees for them to feel safe and
/// protected.
///
/// The warmth and humidity of the habitat affect how much a sloth's ``Sloth/energyLevel``
/// increases when they sleep:
///
/// ```swift
/// let lovelyHabitat = Habitat(isHumid: true, isWarm: true)
/// let coldDryHabitat = Habitat(isHumid: false, isWarm: false)
///
/// warmSloth.sleep(in: lovelyHabitat)
/// icySloth.sleep(in: coldDryHabitat, for: 22)
/// ```
public struct Habitat {
    /// An indicator of whether the habitat is humid.
    public var isHumid: Bool
    
    /// An indicator of whether the habitat is warm.
    public var isWarm: Bool
    
    /// An indicator of how comfortable a sloth might find the habitat.
    public var comfortLevel: Int {
        if isHumid && isWarm {
            return 10
        } else if isHumid || isWarm {
            return 5
        } else {
            return 1
        }
    }
    
    /// Creates a habitat with the specified humidity and temperature.
    public init(isHumid: Bool, isWarm: Bool) {
        self.isHumid = isHumid
        self.isWarm = isWarm
    }
}

