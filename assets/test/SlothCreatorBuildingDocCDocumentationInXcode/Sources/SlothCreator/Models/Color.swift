/*
See LICENSE folder for this sample’s licensing information.

Abstract:
The model type for the color of a sloth.
*/

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
