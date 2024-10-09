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

const BaseReporter = require('mocha/lib/reporters/base');
const SpecReporter = require('mocha/lib/reporters/spec');
const JsonReporter = require('mocha/lib/reporters/json');

// Taking inspiration from https://github.com/stanleyhlng/mocha-multi-reporters/issues/108#issuecomment-2028773686
// since mocha-multi-reporters seems to have bugs with newer mocha versions
module.exports = class MultiReporter extends BaseReporter {
  constructor(runner, options) {
    super(runner, options);
    this.reporters = [
      new SpecReporter(runner, {
        reporterOption: options.reporterOption.specReporterOptions,
      }),
      new JsonReporter(runner, {
        reporterOption: options.reporterOption.jsonReporterOptions,
      }),
    ];
  }
};