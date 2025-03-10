import XCTest
@testable import Module2

internal final class Module2Tests: XCTestCase {
    private var sut: Module2!

    override internal func setUp() {
        super.setUp()
        sut = .init()
    }

    override internal func tearDown() {
        sut = nil
        super.tearDown()
    }

    internal func test_add_with5And2_shouldReturn3() {
        XCTAssertEqual(sut.subtract(5, 2), 3)
    }
}