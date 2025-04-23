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

export class ThemeObserver {
    private readonly body: HTMLElement;
    private readonly observer: MutationObserver;

    constructor() {
        this.body = document.body;
        this.observer = new MutationObserver(mutationsList => {
            for (const mutation of mutationsList) {
                if (mutation.type === "attributes" && mutation.attributeName === "class") {
                    this.updateTheme();
                }
            }
        });
    }

    /**
     * Updates the `data-color-scheme` attribute on <body/> based on the
     * current VS Code theme.
     */
    updateTheme() {
        if (this.body.classList.contains("vscode-dark")) {
            this.body.setAttribute("data-color-scheme", "dark");
        } else if (this.body.classList.contains("vscode-light")) {
            this.body.setAttribute("data-color-scheme", "light");
        } else if (this.body.classList.contains("vscode-high-contrast")) {
            if (this.body.classList.contains("vscode-high-contrast-light")) {
                this.body.setAttribute("data-color-scheme", "light");
            } else {
                this.body.setAttribute("data-color-scheme", "dark");
            }
        }
    }

    /** Begin listening for theme updates. */
    start() {
        this.observer.observe(this.body, { attributes: true, attributeFilter: ["class"] });
    }

    /** Stop listening for theme updates. */
    stop() {
        this.observer.disconnect();
    }
}
