import { expect } from "chai";
import { findBinaryPath } from "../../../src/utilities/shell";

suite("Shell Unit Test Suite", () => {
    suite("findBinaryPath", () => {
        test("returns the path to a binary in the PATH", async () => {
            const binaryPath = await findBinaryPath("node");
            expect(binaryPath).to.be.a("string");
            expect(binaryPath).to.include("node");
        });

        test("throws for a non-existent binary", async () => {
            try {
                await findBinaryPath("nonexistentbinary");
                expect.fail("Expected an error to be thrown for a non-existent binary");
            } catch (error) {
                expect(error).to.be.an("error");
            }
        });
    });
});
