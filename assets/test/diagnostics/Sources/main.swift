func myFunc() -> Int {
    var unused = "hello"
    return 1
}

let foo = myFunc()
let bar = 2
bar = 3
var line: String?
repeat { 
  print("Enter a string: ", terminator: "")
  line = readLine()
  print(line ?? "nil")
} while line != nil;
