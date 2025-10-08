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
// Use source-map-support to get better stack traces
import "source-map-support/register";

import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiSubset from "chai-subset";
import * as fs from "fs";
import * as path from "path";
import * as sinonChai from "sinon-chai";
import * as tsConfigPaths from "tsconfig-paths";

import { installTagSupport } from "./tags";

const tsConfig = JSON.parse(
    // __dirname points to dist/test when transpiled, but we need the tsconfig.json in the real test/
    fs.readFileSync(path.join(__dirname, "../../test/tsconfig.json"), "utf-8")
);
tsConfigPaths.register({
    baseUrl: __dirname,
    paths: tsConfig.compilerOptions.paths,
});

chai.use(sinonChai);
chai.use(chaiAsPromised);
chai.use(chaiSubset);

installTagSupport();
