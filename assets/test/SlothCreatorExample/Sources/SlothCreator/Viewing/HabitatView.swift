/*
See LICENSE folder for this sample’s licensing information.

Abstract:
A view that displays a sloth's habitat.
*/

import SwiftUI

/// A view that displays a sloth's habitat.
///
/// - Note: This sample code project doesn't implement this view.
///
/// ## Topics
/// ### Creating a Habitat View
/// - ``init(habitat:)``
///
/// ### Implementing the View
/// - ``body``
public struct HabitatView: View {
    var habitat: Habitat
    
    /// Creates a view that displays the specified habitat.
    public init(habitat: Habitat) {
        self.habitat = habitat
    }
    
    public var body: some View {
        EmptyView()
    }
}

// Note: This sample code project doesn't implement this view.
struct HabitatView_Previews: PreviewProvider {
    static var previews: some View {
        HabitatView(habitat: Habitat(isHumid: true, isWarm: true))
    }
}
