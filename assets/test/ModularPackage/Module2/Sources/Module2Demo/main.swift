import Module2

private let module = Module2()

@MainActor
func check(_ x: Int, _ y: Int) {
    print(module.subtract(x, y))
}

check(1, 2)
check(2, 3)
