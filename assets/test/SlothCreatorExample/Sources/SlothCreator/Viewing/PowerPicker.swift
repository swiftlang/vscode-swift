/*
See LICENSE folder for this sample’s licensing information.

Abstract:
A view to configure a sloth's power.
*/

import SwiftUI

/// A view to configure a sloth's power.
///
/// ## Topics
/// ### Creating a Power Picker
/// - ``init(power:)``
///
/// ### Implementing the View
/// - ``body``
public struct PowerPicker: View {
    @Binding var power: Sloth.Power
    
    /// Creates a view that configures a sloth's power.
    ///
    /// - Parameter power: A binding to the selected power.
    public init(power: Binding<Sloth.Power>) {
        self._power = power
    }
    
    public var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())]) {
            ForEach(Sloth.Power.allCases, id: \.rawValue) { power in
                Button(action: { self.power = power }) {
                    Image("\(power.rawValue)-power", bundle: Bundle.module)
                        .resizable()
                        .scaledToFit()
                }.padding()
            }
        }
    }
}

struct PowerPicker_Previews: PreviewProvider {
    @State static var power = Sloth.Power.ice
    
    static var previews: some View {
        PowerPicker(power: $power)
            .previewDevice(PreviewDevice(rawValue: "iPhone 12"))
    }
}
