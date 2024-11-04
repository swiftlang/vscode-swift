/*
See LICENSE folder for this sample’s licensing information.

Abstract:
A view that displays a sloth.
*/

import SwiftUI

/// A view that displays a sloth.
///
/// You create a sloth view by providing a ``Sloth`` binding.
/// Depending on the attributes and state of the provided sloth,
/// the view loads a matching image representation, such as:
///
/// ```swift
/// @State private var sloth: Sloth
///
/// var body: some View {
///     SlothView(sloth: $sloth)
/// }
/// ```
public struct SlothView: View {
    @Binding var sloth: Sloth
    
    /// Creates a view that displays the specified sloth.
    public init(sloth: Binding<Sloth>) {
        self._sloth = sloth
    }
    
    public var body: some View {
        Image("\(sloth.power)-sloth", bundle: Bundle.module)
            .resizable()
            .scaledToFit()
            .padding()
    }
}

struct SlothView_Previews: PreviewProvider {
    @State static var sloth = Sloth(name: "Super Sloth", color: .green, power: .ice)
    
    static var previews: some View {
        SlothView(sloth: $sloth)
            .previewDevice(PreviewDevice(rawValue: "iPhone 12"))
    }
}

