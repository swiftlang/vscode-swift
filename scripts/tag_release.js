//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
const { execFile } = require('node:child_process');
execFile('./tag_release.sh', [process.env.npm_package_version], (error, stdout) => {
  if (error) {
    throw error;
  }
  console.log(stdout);
}); 