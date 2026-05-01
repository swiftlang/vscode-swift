#if swift(>=6.0)
import Testing

@Test func secondTargetTestPassing() {
  #expect(1 == 1)
}

@Suite
struct SecondTargetSuite {
  @Test
  func testPassing() throws {}
}
#endif
