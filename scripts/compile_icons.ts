//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
/* eslint-disable no-console */
import { FontAssetType, generateFonts } from "@twbs/fantasticon";
import { CodepointsMap } from "@twbs/fantasticon/lib/utils/codepoints";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import * as path from "path";
import * as svgo from "svgo";

import { config } from "../src/icons/config";
import { main, withTemporaryDirectory } from "./lib/utilities";

/**
 * Minifies and colors the provided icon.
 *
 * @param icon The icon in SVG format.
 * @param color The color of the resulting icon.
 * @returns The minified and colored icon in SVG format.
 */
function minifyIcon(icon: string, color: string = "#424242"): string {
    return svgo.optimize(icon, {
        plugins: [
            {
                name: "removeAttrs",
                params: {
                    attrs: "fill",
                },
            },
            {
                name: "addAttributesToSVGElement",
                params: {
                    attributes: [
                        {
                            fill: color,
                        },
                    ],
                },
            },
        ],
    }).data;
}

main(async () => {
    const iconsSourceDirectory = path.join(__dirname, "../src/icons");
    const iconAssetsDirectory = path.join(__dirname, "../assets/icons");
    await rm(iconAssetsDirectory, { recursive: true, force: true });
    await mkdir(path.join(iconAssetsDirectory, "light"), { recursive: true });
    await mkdir(path.join(iconAssetsDirectory, "dark"), { recursive: true });

    await withTemporaryDirectory("swift-vscode-icons_", async fontIconBuildDirectory => {
        const iconsToConvert = (await readdir(iconsSourceDirectory, { withFileTypes: true }))
            .filter(entity => entity.isFile() && path.extname(entity.name) === ".svg")
            .map(entity => path.join(iconsSourceDirectory, entity.name));
        const codepoints: CodepointsMap = {};
        for (const iconPath of iconsToConvert) {
            const iconBasename = path.basename(iconPath);
            // Find the icon inside the configuration file
            const iconName = iconBasename.slice(0, -4); // Remove ".svg"
            if (!(iconName in config.icons)) {
                throw new Error(
                    `Unable to find configuration for "${iconName}" in "src/icons/config.ts"`
                );
            }
            const iconConfig = config.icons[iconName];
            codepoints[iconName] = iconConfig.codepoint;
            const color = iconConfig.color ?? { light: "#424242", dark: "#C5C5C5" };
            // Minify and write the icon into the temporary directory that will be processed
            // later by fantasticons.
            const iconContents = await readFile(iconPath, "utf-8");
            const optimizedIcon = minifyIcon(iconContents);
            await writeFile(
                path.join(fontIconBuildDirectory, iconBasename),
                optimizedIcon,
                "utf-8"
            );
            // Write the minified icon into the output directory based on its color configuration
            if (typeof color === "string") {
                // A single icon will be output with the provided color
                const coloredIcon = minifyIcon(iconContents, color);
                await writeFile(path.join(iconAssetsDirectory, iconBasename), coloredIcon, "utf-8");
            } else {
                // A light and dark icon will be output with the provided colors
                const lightIcon = minifyIcon(iconContents, color.light);
                await writeFile(
                    path.join(iconAssetsDirectory, "light", iconBasename),
                    lightIcon,
                    "utf-8"
                );
                const darkIcon = minifyIcon(iconContents, color.dark);
                await writeFile(
                    path.join(iconAssetsDirectory, "dark", iconBasename),
                    darkIcon,
                    "utf-8"
                );
            }
        }
        // Generate the icon font
        await generateFonts({
            name: "icon-font",
            inputDir: fontIconBuildDirectory,
            outputDir: iconAssetsDirectory,
            fontTypes: [FontAssetType.WOFF],
            assetTypes: [],
            codepoints,
        });
    });
});
