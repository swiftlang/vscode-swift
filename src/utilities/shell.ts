import { execFile } from "./utilities";

export async function findBinaryPath(binaryName: string): Promise<string> {
    const { stdout, stderr } = await execFile("/bin/sh", [
        "-c",
        `LC_MESSAGES=C type ${binaryName}`,
    ]);
    const binaryNameMatch = new RegExp(`^${binaryName} is (.*)$`).exec(stdout.trimEnd());
    if (binaryNameMatch) {
        return binaryNameMatch[1];
    } else {
        throw Error(
            `/bin/sh -c LC_MESSAGES=C type ${binaryName}: stdout: ${stdout}, stderr: ${stderr}`
        );
    }
}
