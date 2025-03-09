import Module1

private let module = Module1()

@MainActor
func check(_ x: Int, _ y: Int) {
    print(module.add(x, y))
}

check(1, 2)
check(2, 3)
