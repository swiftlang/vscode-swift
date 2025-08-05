//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2025 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
/* eslint-disable no-console */

import { getExtensionVersion, main, packageExtension } from "./lib/utilities";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main(async () => {
    const version = await getExtensionVersion();
    const devVersion = `${version.major}.${version.minor}.${version.patch}-dev`;
    await packageExtension(devVersion);
});
