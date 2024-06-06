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

final class DebugReleaseTestSuite: XCTestCase {
  func testRelease() throws {
    #if DEBUG
      XCTFail("Test was run in debug mode.")
    #endif
  }

  func testDebug() throws {
    #if RELEASE
      XCTFail("Test was run in release mode.")
    #endif
  }
}

#if swift(>=6.0)
import Testing

@Test func topLevelTestPassing() {}
@Test func topLevelTestFailing() {
  #expect(1 == 2)
}

@Test(arguments: [1, 2, 3])
func parameterizedTest(_ arg: Int) {
  #expect(arg != 2)
}

@Test func testRelease() throws {
  #if DEBUG
    Issue.record("Test was run in debug mode.")
  #endif
}

@Test func testDebug() throws {
  #if RELEASE
    Issue.record("Test was run in release mode.")
  #endif
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
