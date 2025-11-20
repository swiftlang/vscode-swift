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
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiSubset from "chai-subset";
import * as fs from "fs";
import * as mockFS from "mock-fs";
import * as path from "path";
import * as sinonChai from "sinon-chai";
import * as sourceMapSupport from "source-map-support";
import * as tsConfigPaths from "tsconfig-paths";

import { chaiPathPlugin } from "./chai-path-plugin";
import { installTagSupport } from "./tags";

// Use source-map-support to get better stack traces.
//
// We have to override retrieveFile() here because any test that uses mock-fs will break
// source map lookups. This will make sure that, even if mock-fs is in effect, source map
// support can still find the files that it needs to.
sourceMapSupport.install({
    retrieveFile(path: string): string | null {
        return mockFS.bypass(() => {
            if (!fs.existsSync(path)) {
                return null;
            }
            return fs.readFileSync(path, "utf-8");
        });
    },
});

const tsConfig = JSON.parse(
    // __dirname points to dist/test when transpiled, but we need the tsconfig.json in the real test/
    fs.readFileSync(path.join(__dirname, "../../test/tsconfig.json"), "utf-8")
);
tsConfigPaths.register({
    baseUrl: __dirname,
    paths: tsConfig.compilerOptions.paths,
});

// Install chai plugins
chai.use(sinonChai);
chai.use(chaiSubset);
chai.use(chaiPathPlugin);
// chai-as-promised must always be installed last!
chai.use(chaiAsPromised);

installTagSupport();
