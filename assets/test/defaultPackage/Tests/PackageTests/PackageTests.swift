import PackageLib
import XCTest

final class PassingXCTestSuite: XCTestCase {
  func testPassing() throws {}
}

// Should not run when PassingXCTestSuite is run.
final class PassingXCTestSuite2: XCTestCase {
  func testPassing() throws {}
}

final class FailingXCTestSuite: XCTestCase {
  func testFailing() throws {
    XCTFail("oh no")
  }
}

final class MixedXCTestSuite: XCTestCase {
  func testPassing() throws {}

  func testFailing() throws {
    XCTFail("oh no")
  }
}

#if swift(>=5.10)
import Testing

@Test func topLevelTestPassing() {}
@Test func topLevelTestFailing() {
  #expect(1 == 2)
}

@Suite
struct MixedSwiftTestingSuite {
  @Test
  func testPassing() throws {}

  @Test
  func testFailing() throws {
    #expect(1 == 2)
  }

  @Test(.disabled()) func testDisabled() {}
}

@Test func testWithKnownIssue() throws {
  withKnownIssue {
    #expect(1 == 2)
  }
}

@Test func testWithKnownIssueAndUnknownIssue() throws {
  withKnownIssue {
    #expect(1 == 2)
  }
  #expect(2 == 3)
}

#endif
