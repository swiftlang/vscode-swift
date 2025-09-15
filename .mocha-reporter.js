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

const mocha = require("mocha");
const GHASummaryReporter = require("./dist/test/reporters/GitHubActionsSummaryReporter");

// Taking inspiration from https://github.com/stanleyhlng/mocha-multi-reporters/issues/108#issuecomment-2028773686
// since mocha-multi-reporters seems to have bugs with newer mocha versions
module.exports = class MultiReporter extends mocha.reporters.Base {
    constructor(runner, options) {
        super(runner, options);
        this.reporters = [
            new mocha.reporters.Spec(runner, {
                reporterOption: options.reporterOption.specReporterOptions,
            }),
            new GHASummaryReporter(runner, {
                reporterOption: options.reporterOption.githubActionsSummaryReporterOptions,
            }),
            new mocha.reporters.JSON(runner, {
                reporterOption: options.reporterOption.jsonReporterOptions,
            }),
        ];
    }
};
