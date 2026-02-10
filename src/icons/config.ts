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

// New icons must be added to the package.json under the "icons" contribution
// point in order to be useable from within VS Code.
export const config: IconConfiguration = {
    icons: {
        "swift-icon": { codepoint: 0xe001, color: "#FA7343" },
        "swift-documentation": { codepoint: 0xe002 },
        "swift-documentation-preview": { codepoint: 0xe003 },
    },
};

/**
 * Config used by scripts/compile_icons.ts to generate the SVG icons and
 * icon font file.
 */
interface IconConfiguration {
    icons: {
        [key: string]: {
            /**
             * The codepoint at which to place the icon within the icon font.
             */
            codepoint: number;

            /**
             * The color to use for the resulting icon. Either a single color
             * or colors for both light and dark themes.
             *
             * If no color is specified then a light and dark icon will be
             * generated with default colors.
             *
             * Note: this does not affect the icon font at all. Only the
             * standalone SVGs compiled into assets/icons can have colors.
             */
            color?: IconColor;
        };
    };
}

type IconColor = string | { light: string; dark: string };
