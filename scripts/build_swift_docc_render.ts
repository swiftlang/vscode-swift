//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
/* eslint-disable no-console */
import { mkdir, readdir, rm, stat } from "fs/promises";
import * as path from "path";
import * as semver from "semver";
import simpleGit, { ResetMode } from "simple-git";

import { exec, getRootDirectory, main, withTemporaryDirectory } from "./lib/utilities";

function checkNodeVersion() {
    const nodeVersion = semver.parse(process.versions.node);
    if (nodeVersion === null) {
        throw new Error(
            "Unable to determine the version of NodeJS that this script is running under."
        );
    }
    if (!semver.satisfies(nodeVersion, "^22.17")) {
        throw new Error(
            `Cannot build swift-docc-render with NodeJS v${nodeVersion.raw}. Please install and use at least NodeJS v22.17.x.`
        );
    }
}

async function cloneSwiftDocCRender(buildDirectory: string): Promise<string> {
    // Clone swift-docc-render
    const swiftDocCRenderDirectory = path.join(buildDirectory, "swift-docc-render");
    const git = simpleGit({ baseDir: buildDirectory });
    console.log("> git clone https://github.com/swiftlang/swift-docc-render.git");
    const revision = "c781d3783f23fda5a4721f5361c6c523772b7a62";
    await git.clone("https://github.com/swiftlang/swift-docc-render.git", swiftDocCRenderDirectory);
    await git.cwd(swiftDocCRenderDirectory);
    await git.reset(ResetMode.HARD, [revision]);
    // Apply our patches to swift-docc-render
    const patches = (
        await readdir(path.join(__dirname, "patches", "swift-docc-render"), {
            withFileTypes: true,
        })
    )
        .filter(entity => entity.isFile() && entity.name.endsWith(".patch"))
        .map(entity => path.join(entity.path, entity.name))
        .sort();
    console.log("> git apply \\\n" + patches.map(e => "    " + e).join(" \\\n"));
    await git.applyPatch(patches);
    return swiftDocCRenderDirectory;
}

main(async () => {
    const outputDirectory = path.join(getRootDirectory(), "assets", "swift-docc-render");
    if (process.argv.includes("postinstall")) {
        try {
            await stat(outputDirectory);
            console.log(`${outputDirectory} exists, skipping build.`);
            return;
        } catch {
            // Proceed with creating
        }
    }
    checkNodeVersion();
    await rm(outputDirectory, { force: true, recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await withTemporaryDirectory("build-swift-docc-render_", async buildDirectory => {
        const swiftDocCRenderDirectory = await cloneSwiftDocCRender(buildDirectory);
        await exec("npm", ["install"], { cwd: swiftDocCRenderDirectory });
        await exec("npx", ["vue-cli-service", "build", "--dest", outputDirectory], {
            cwd: swiftDocCRenderDirectory,
            env: {
                ...process.env,
                VUE_APP_TARGET: "ide",
            },
        });
    });
});
