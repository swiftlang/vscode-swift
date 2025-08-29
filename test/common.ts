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
import * as sinonChai from "sinon-chai";
import * as chaiAsPromised from "chai-as-promised";
import * as chaiSubset from "chai-subset";
import { installTagSupport } from "./tags";

chai.use(sinonChai);
chai.use(chaiAsPromised);
chai.use(chaiSubset);

installTagSupport();
