/*
See LICENSE folder for this sample’s licensing information.

Abstract:
An activity a sloth may perform.
*/

/// A type that declares an activity a Sloth can perform.
public protocol Activity {
    /// Performs the work or sequence of actions for an activity.
    ///
    /// - parameter sloth: The sloth performing the activity.
    /// - returns: The speed at which the sloth performs the activity.
    func perform(with sloth: inout Sloth) -> Speed
}

/// A measure of a sloth's speed during an activity.
///
/// ## Topics
///
/// ### Speeds
///
/// - ``slow``
/// - ``medium``
/// - ``fast``
/// - ``supersonic``
///
/// ### Comparing Speeds
///
/// - ``!=(_:_:)``
public enum Speed {
    /// Moves slightly faster than a snail.
    case slow
    /// Moves at an average speed.
    case medium
    /// Moves faster than a hare.
    case fast
    /// Moves faster than the speed of sound.
    case supersonic
}
