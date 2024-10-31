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

import { expect } from "chai";
import { DocumentSymbol, SymbolKind, Range, Position } from "vscode";
import {
    findDocumentableSymbolAtPosition,
    convertSymbolToDocumentationRoute,
} from "../../../src/documentation/symbolSearch";

suite("Documentation Symbol Search Unit Tests", () => {
    let documentSymbols: DocumentSymbol[] = [];

    setup(() => {
        // Taken from CareSchedule.swift in the SlothCreator example project
        documentSymbols = [
            {
                name: "CareSchedule",
                kind: SymbolKind.Struct,
                detail: "",
                range: new Range(10, 0, 33, 1),
                selectionRange: new Range(10, 14, 10, 26),
                children: [
                    {
                        name: "events",
                        kind: SymbolKind.Property,
                        detail: "",
                        range: new Range(12, 4, 12, 43),
                        selectionRange: new Range(12, 15, 12, 21),
                        children: [],
                    },
                    {
                        name: "Event",
                        kind: SymbolKind.Enum,
                        detail: "",
                        range: new Range(15, 4, 26, 5),
                        selectionRange: new Range(15, 16, 15, 21),
                        children: [
                            {
                                name: "breakfast",
                                kind: SymbolKind.EnumMember,
                                detail: "",
                                range: new Range(17, 13, 17, 22),
                                selectionRange: new Range(17, 13, 17, 22),
                                children: [],
                            },
                            {
                                name: "lunch",
                                kind: SymbolKind.EnumMember,
                                detail: "",
                                range: new Range(19, 13, 19, 18),
                                selectionRange: new Range(19, 13, 19, 18),
                                children: [],
                            },
                            {
                                name: "dinner",
                                kind: SymbolKind.EnumMember,
                                detail: "",
                                range: new Range(21, 13, 21, 19),
                                selectionRange: new Range(21, 13, 21, 19),
                                children: [],
                            },
                            {
                                name: "bedtime",
                                kind: SymbolKind.EnumMember,
                                detail: "",
                                range: new Range(23, 13, 23, 20),
                                selectionRange: new Range(23, 13, 23, 20),
                                children: [],
                            },
                            {
                                name: "activity(_:)",
                                kind: SymbolKind.EnumMember,
                                detail: "",
                                range: new Range(25, 13, 25, 31),
                                selectionRange: new Range(25, 13, 25, 31),
                                children: [],
                            },
                        ],
                    },
                    {
                        name: "init(events:)",
                        kind: SymbolKind.Constructor,
                        detail: "",
                        range: new Range(30, 4, 32, 5),
                        selectionRange: new Range(30, 11, 30, 45),
                        children: [],
                    },
                ],
            },
        ];
    });

    test("finds a symbol when the cursor is directly within the symbol identifier", () => {
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(10, 17)))
            .to.have.property("name")
            .that.equals("CareSchedule");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(12, 7)))
            .to.have.property("name")
            .that.equals("events");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(15, 17)))
            .to.have.property("name")
            .that.equals("Event");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(17, 14)))
            .to.have.property("name")
            .that.equals("breakfast");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(19, 14)))
            .to.have.property("name")
            .that.equals("lunch");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(21, 14)))
            .to.have.property("name")
            .that.equals("dinner");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(23, 14)))
            .to.have.property("name")
            .that.equals("bedtime");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(25, 14)))
            .to.have.property("name")
            .that.equals("activity(_:)");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(30, 14)))
            .to.have.property("name")
            .that.equals("init(events:)");
    });

    test("finds a symbol when the cursor is within the comment above the symbol", () => {
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(9, 0)))
            .to.have.property("name")
            .that.equals("CareSchedule");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(11, 0)))
            .to.have.property("name")
            .that.equals("events");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(14, 0)))
            .to.have.property("name")
            .that.equals("Event");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(16, 0)))
            .to.have.property("name")
            .that.equals("breakfast");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(18, 0)))
            .to.have.property("name")
            .that.equals("lunch");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(20, 0)))
            .to.have.property("name")
            .that.equals("dinner");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(22, 0)))
            .to.have.property("name")
            .that.equals("bedtime");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(24, 0)))
            .to.have.property("name")
            .that.equals("activity(_:)");
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(29, 0)))
            .to.have.property("name")
            .that.equals("init(events:)");
    });

    test("finds the constructor symbol when the cursor is within the constructor body", () => {
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(31, 17)))
            .to.have.property("name")
            .that.equals("init(events:)");
    });

    test("finds a symbol when the cursor is within the symbol's comment and its siblings are not ordered by position", () => {
        const documentSymbols: DocumentSymbol[] = [
            {
                name: "MyStruct",
                kind: SymbolKind.Struct,
                detail: "",
                range: new Range(0, 0, 7, 1),
                selectionRange: new Range(0, 14, 0, 22),
                children: [
                    // A comment would exist above this symbol on line 1
                    {
                        name: "property",
                        kind: SymbolKind.Property,
                        detail: "",
                        range: new Range(2, 4, 2, 16),
                        selectionRange: new Range(2, 8, 2, 16),
                        children: [],
                    },
                    // A comment would exist above this symbol on line 5
                    {
                        name: "init()",
                        kind: SymbolKind.Constructor,
                        detail: "",
                        range: new Range(6, 2, 8, 1),
                        selectionRange: new Range(6, 2, 6, 6),
                        children: [],
                    },
                    // A comment would exist above this symbol on line 3
                    {
                        name: "Enumeration",
                        kind: SymbolKind.Enum,
                        detail: "",
                        range: new Range(4, 4, 4, 25),
                        selectionRange: new Range(4, 9, 4, 20),
                        children: [],
                    },
                ],
            },
        ];
        // Try to find the comment above the "Enumeration" symbol
        expect(findDocumentableSymbolAtPosition(documentSymbols, new Position(3, 13)))
            .to.have.property("name")
            .that.equals("Enumeration");
    });

    test("converts a symbol into its documentation route", () => {
        expect(
            convertSymbolToDocumentationRoute(
                {
                    name: "breakfast",
                    kind: SymbolKind.EnumMember,
                    detail: "",
                    range: new Range(17, 13, 17, 22),
                    selectionRange: new Range(17, 13, 17, 22),
                    children: [],
                },
                documentSymbols
            )
        ).to.equal("/CareSchedule/Event/breakfast");
    });
});
