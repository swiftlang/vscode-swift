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
import js from "@eslint/js";
import tsESLint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import mocha from "eslint-plugin-mocha";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import sonarjs from "eslint-plugin-sonarjs";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

const baseLanguageOptions = {
    ecmaVersion: 2022,
    sourceType: "module",
};

export default defineConfig([
    globalIgnores([
        "./.vscode-test",
        "./assets",
        "./out",
        "./dist",
        "./userdocs",
        "./src/typings/node-pty.d.ts",
    ]),
    {
        files: ["./**/*.{js,mjs}"],
        extends: [js.configs.recommended, sonarjs.configs.recommended],
        languageOptions: {
            ...baseLanguageOptions,
            globals: globals.node,
        },
    },
    {
        files: ["./**/*.ts"],
        extends: [
            js.configs.recommended,
            tsESLint.configs["flat/recommended"],
            sonarjs.configs.recommended,
            eslintPluginPrettierRecommended,
        ],
        plugins: {
            "@typescript-eslint": tsESLint,
        },
        languageOptions: {
            ...baseLanguageOptions,
            parser: tsParser,
            parserOptions: {
                project: true,
            },
        },
        rules: {
            curly: "error",
            eqeqeq: "warn",
            "no-throw-literal": "warn",
            "no-console": "warn",
            "no-restricted-syntax": [
                "error",
                {
                    selector:
                        "CallExpression[callee.object.object.callee.name='tag'][callee.property.name='only']",
                    message:
                        "Unexpected exclusive mocha test with tag().suite.only() or tag().test.only()",
                },
                {
                    selector: "ImportExpression",
                    message:
                        "Dynamic imports using 'import()' are not allowed. Use static imports at the top of the file instead.",
                },
                {
                    selector:
                        "CallExpression[arguments.length=1] > MemberExpression.callee > Identifier.property[name='reduce']",
                    message:
                        "Provide initialValue to .reduce(). Otherwise an empty array will throw a 'reduce of empty array with no initial value' error.",
                },
                {
                    selector:
                        "CallExpression[arguments.length=1] > MemberExpression.callee > Identifier.property[name='reduceRight']",
                    message:
                        "Provide initialValue to .reduceRight(). Otherwise an empty array will throw a 'reduce of empty array with no initial value' error.",
                },
            ],

            "@typescript-eslint/no-floating-promises": ["warn", { checkThenables: true }],
            "@typescript-eslint/await-thenable": "warn",
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    args: "all",
                    argsIgnorePattern: "^_",
                    caughtErrors: "none",
                },
            ],

            "sonarjs/cognitive-complexity": ["error", 15],
            "sonarjs/use-type-alias": "off",
            "sonarjs/function-return-type": "off",
            "sonarjs/slow-regex": "off",
            "sonarjs/publicly-writable-directories": "off",
            "sonarjs/no-same-argument-assert": "off",
            "sonarjs/no-invariant-returns": "off",
            "sonarjs/fixme-tag": "off",
            "sonarjs/todo-tag": "off",

            // These should be progressively enabled over time as we fix the underlying issues
            "sonarjs/no-ignored-exceptions": "off",
            "sonarjs/no-async-constructor": "off",
        },
    },
    {
        files: ["./test/**/*.ts"],
        plugins: { mocha },
        rules: {
            "no-console": "off",

            "mocha/no-exclusive-tests": "error",

            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-expressions": "off",
        },
    },
]);
