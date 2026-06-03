//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2026 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
import { expect } from "chai";

import { safeBareRepositoryEnvironmentOverride } from "@src/utilities/gitConfig";

suite("safeBareRepositoryEnvironmentOverride", () => {
    test("returns nothing when no GIT_CONFIG variables are present", () => {
        expect(safeBareRepositoryEnvironmentOverride({})).to.deep.equal({});
    });

    test("returns nothing when GIT_CONFIG_COUNT is missing but keys exist", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_KEY_0: "safe.bareRepository",
                GIT_CONFIG_VALUE_0: "explicit",
            })
        ).to.deep.equal({});
    });

    test("overrides safe.bareRepository=explicit at index 0", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "safe.bareRepository",
                GIT_CONFIG_VALUE_0: "explicit",
            })
        ).to.deep.equal({ GIT_CONFIG_VALUE_0: "all" });
    });

    test("overrides safe.bareRepository=explicit at a non-zero index", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_COUNT: "3",
                GIT_CONFIG_KEY_0: "http.sslVerify",
                GIT_CONFIG_VALUE_0: "true",
                GIT_CONFIG_KEY_1: "core.autocrlf",
                GIT_CONFIG_VALUE_1: "false",
                GIT_CONFIG_KEY_2: "safe.bareRepository",
                GIT_CONFIG_VALUE_2: "explicit",
            })
        ).to.deep.equal({ GIT_CONFIG_VALUE_2: "all" });
    });

    test("overrides every safe.bareRepository=explicit entry", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_COUNT: "2",
                GIT_CONFIG_KEY_0: "safe.bareRepository",
                GIT_CONFIG_VALUE_0: "explicit",
                GIT_CONFIG_KEY_1: "safe.bareRepository",
                GIT_CONFIG_VALUE_1: "explicit",
            })
        ).to.deep.equal({ GIT_CONFIG_VALUE_0: "all", GIT_CONFIG_VALUE_1: "all" });
    });

    test("leaves safe.bareRepository entries that are not explicit untouched", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "safe.bareRepository",
                GIT_CONFIG_VALUE_0: "all",
            })
        ).to.deep.equal({});
    });

    test("ignores entries beyond GIT_CONFIG_COUNT", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_COUNT: "1",
                GIT_CONFIG_KEY_0: "http.sslVerify",
                GIT_CONFIG_VALUE_0: "true",
                GIT_CONFIG_KEY_1: "safe.bareRepository",
                GIT_CONFIG_VALUE_1: "explicit",
            })
        ).to.deep.equal({});
    });

    test("returns nothing when GIT_CONFIG_COUNT is not a valid number", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_COUNT: "not-a-number",
                GIT_CONFIG_KEY_0: "safe.bareRepository",
                GIT_CONFIG_VALUE_0: "explicit",
            })
        ).to.deep.equal({});
    });

    test("returns nothing when GIT_CONFIG_COUNT is zero or negative", () => {
        expect(
            safeBareRepositoryEnvironmentOverride({
                GIT_CONFIG_COUNT: "0",
                GIT_CONFIG_KEY_0: "safe.bareRepository",
                GIT_CONFIG_VALUE_0: "explicit",
            })
        ).to.deep.equal({});
    });
});
