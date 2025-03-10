import XCTest
@testable import Module1

internal final class Module1Tests: XCTestCase {
    private var sut: Module1!

    override internal func setUp() {
        super.setUp()
        sut = .init()
    }

    override internal func tearDown() {
        sut = nil
        super.tearDown()
    }

    internal func test_add_with1And2_shouldReturn3() {
        XCTAssertEqual(sut.add(1, 2), 3)
    }
}