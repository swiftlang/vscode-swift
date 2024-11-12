/*
See LICENSE folder for this sample’s licensing information.

Abstract:
The model type for the power of a sloth.
*/

import Foundation

extension Sloth {
    /// The power of a sloth.
    public enum Power: String, CaseIterable, CustomStringConvertible {
        /// The ice power.
        ///
        /// Ice sloths thrive below freezing temperatures. Their claws have the power of summoning snow and ice.
        /// Despite their usual slowness, their metabolism has the ability of speeding up for snowball fights.
        case ice

        /// The fire power.
        ///
        /// Fire sloths thrive at boiling temperatures. Their claws have the power of summoning fire.
        /// A fire sloth is happiest while taking a lava bath.
        case fire

        /// The wind power.
        ///
        /// Wind sloths thrive at soaring altitudes. Their claws have the power of summoning wind, propelling their furry
        /// bodies through the air in a motion similar to flying. The high speed of the wind causes the sloths' fur to
        /// be in perpetual disarray.
        case wind

        /// The lightning power.
        ///
        /// Lightning sloths thrive in stormy climates. Their claws have the power of summoning lightning. Beware of
        /// shaking a lightning sloth's hand without rubber shoes.
        case lightning

        /// No special power.
        ///
        /// Standard sloths are still extraordinary creatures. Their claws have the power of holding onto tree branches,
        /// rocky outcrops, and outstretched arms. They might be slow, but they are still magnificent.
        case none
        
        public var description: String {
            return rawValue
        }
    }
}
