/*
See LICENSE folder for this sample’s licensing information.

Abstract:
A representation of a schedule of events that provide care for a sloth.
*/

import Foundation

/// A schedule to maintain the health and happiness of a sloth.
public struct CareSchedule {
    /// The actions a sloth performs at scheduled times.
    public var events: [(Date, Event)] = []
    
    /// An action a sloth can perform.
    public enum Event {
        /// A meal that a sloth usually eats at the start of their day, in the morning.
        case breakfast
        /// A meal that a sloth usually eats around the middle of the day, in the early afternoon.
        case lunch
        /// A meal that a sloth usually eats at the end of the day, in the evening.
        case dinner
        /// Time for sleep.
        case bedtime
        /// An activity to perform.
        case activity(Activity)
    }
    
    /// Creates a care schedule with the specified events.
    /// - Parameter events: The actions a sloth performs at scheduled times.
    public init(events: [(Date, Event)] = []) {
        self.events = events
    }
}
