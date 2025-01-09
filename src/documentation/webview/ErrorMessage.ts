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

export class ErrorMessage {
    private readonly containerElement: HTMLDivElement;
    private readonly iconElement: HTMLSpanElement;
    private readonly messageElement: HTMLSpanElement;

    constructor() {
        this.containerElement = createContainer();
        this.iconElement = createIcon();
        this.messageElement = createMessage();
        this.containerElement.appendChild(this.iconElement);
        this.containerElement.appendChild(this.messageElement);
        window.document.body.appendChild(this.containerElement);
    }

    show(message: string) {
        this.messageElement.textContent = message;
        this.containerElement.style.display = "flex";
    }

    hide() {
        this.containerElement.style.display = "none";
    }
}

function createContainer(): HTMLDivElement {
    const containerElement = document.createElement("div");
    containerElement.style.backgroundColor = "var(--vscode-editor-background)";
    containerElement.style.color = "var(--vscode-foreground)";
    containerElement.style.fontFamily = "var(--vscode-font-family)";
    containerElement.style.fontWeight = "var(--vscode-font-weight)";
    containerElement.style.width = "100%";
    containerElement.style.height = "100%";
    containerElement.style.display = "none";
    containerElement.style.gap = "10px";
    containerElement.style.flexDirection = "column";
    containerElement.style.alignItems = "center";
    containerElement.style.justifyContent = "center";
    containerElement.style.position = "absolute";
    containerElement.style.top = "0";
    containerElement.style.left = "0";
    return containerElement;
}

function createIcon(): HTMLSpanElement {
    const iconElement = document.createElement("span");
    iconElement.className = "codicon codicon-error";
    iconElement.style.color = "var(--vscode-editorError-foreground)";
    iconElement.style.fontSize = "48px";
    return iconElement;
}

function createMessage(): HTMLSpanElement {
    const messageElement = document.createElement("span");
    messageElement.style.fontSize = "14px";
    return messageElement;
}
