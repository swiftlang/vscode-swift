//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2021-2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

// We use namespaces to store request information just like vscode-languageclient
/* eslint-disable @typescript-eslint/no-namespace */

import {
    TextDocumentIdentifier,
    Position,
    Location,
    SymbolKind,
    MessageDirection,
    RequestType,
} from "vscode-languageclient";

/** Parameters used to make a {@link SymbolInfoRequest}. */
export interface SymbolInfoParams {
    /** The document in which to lookup the symbol location. */
    textDocument: TextDocumentIdentifier;

    /** The document location at which to lookup symbol information. */
    position: Position;
}

/** Information about which module a symbol is defined in. */
export interface ModuleInfo {
    /** The name of the module in which the symbol is defined. */
    moduleName: string;

    /** If the symbol is defined within a subgroup of a module, the name of the group. */
    groupName?: string;
}

/** Detailed information about a symbol, such as the response to a {@link SymbolInfoRequest}. */
export interface SymbolDetails {
    /** The name of the symbol, if any. */
    name?: string;

    /**
     * The name of the containing type for the symbol, if any.
     *
     * For example, in the following snippet, the `containerName` of `foo()` is `C`.
     *
     * ```c++
     * class C {
     *   void foo() {}
     * }
     * ```
     */
    containerName?: string;

    /** The USR of the symbol, if any. */
    usr?: string;

    /**
     * Best known declaration or definition location without global knowledge.
     *
     * For a local or private variable, this is generally the canonical definition location -
     * appropriate as a response to a `textDocument/definition` request. For global symbols this is
     * the best known location within a single compilation unit. For example, in C++ this might be
     * the declaration location from a header as opposed to the definition in some other
     * translation unit.
     * */
    bestLocalDeclaration?: Location;

    /** The kind of the symbol */
    kind?: SymbolKind;

    /**
     * Whether the symbol is a dynamic call for which it isn't known which method will be invoked at runtime. This is
     * the case for protocol methods and class functions.
     *
     * Optional because `clangd` does not return whether a symbol is dynamic.
     */
    isDynamic?: boolean;

    /**
     * Whether this symbol is defined in the SDK or standard library.
     *
     * This property only applies to Swift symbols.
     */
    isSystem?: boolean;

    /**
     * If the symbol is dynamic, the USRs of the types that might be called.
     *
     * This is relevant in the following cases:
     * ```swift
     * class A {
     *   func doThing() {}
     * }
     * class B: A {}
     * class C: B {
     *   override func doThing() {}
     * }
     * class D: A {
     *   override func doThing() {}
     * }
     * func test(value: B) {
     *   value.doThing()
     * }
     * ```
     *
     * The USR of the called function in `value.doThing` is `A.doThing` (or its
     * mangled form) but it can never call `D.doThing`. In this case, the
     * receiver USR would be `B`, indicating that only overrides of subtypes in
     * `B` may be called dynamically.
     */
    receiverUsrs?: string[];

    /**
     * If the symbol is defined in a module that doesn't have source information associated with it, the name and group
     * and group name that defines this symbol.
     *
     * This property only applies to Swift symbols.
     */
    systemModule?: ModuleInfo;
}

/**
 * Request for semantic information about the symbol at a given location **(LSP Extension)**.
 *
 * This request looks up the symbol (if any) at a given text document location and returns
 * SymbolDetails for that location, including information such as the symbol's USR. The symbolInfo
 * request is not primarily designed for editors, but instead as an implementation detail of how
 * one LSP implementation (e.g. SourceKit) gets information from another (e.g. clangd) to use in
 * performing index queries or otherwise implementing the higher level requests such as definition.
 *
 * - Parameters:
 *   - textDocument: The document in which to lookup the symbol location.
 *   - position: The document location at which to lookup symbol information.
 *
 * - Returns: `[SymbolDetails]` for the given location, which may have multiple elements if there are
 *   multiple references, or no elements if there is no symbol at the given location.
 *
 * ### LSP Extension
 *
 * This request is an extension to LSP supported by SourceKit-LSP and clangd. It does *not* require
 * any additional client or server capabilities to use.
 */
export namespace SymbolInfoRequest {
    export const method = "textDocument/symbolInfo" as const;
    export const messageDirection: MessageDirection = MessageDirection.clientToServer;
    export const type = new RequestType<SymbolInfoParams, SymbolDetails[], never>(method);
}
