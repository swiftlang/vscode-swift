import Foundation

extension Sloth {
    /// The color of a sloth.
    public enum Color: String, CaseIterable, CustomStringConvertible {
        /// The color green.
        case green
        
        /// The color yellow.
        case yellow
        
        /// The color orange.
        case orange
        
        /// The color blue.
        case blue
        
        public var description: String {
            return rawValue
        }
    }
}
