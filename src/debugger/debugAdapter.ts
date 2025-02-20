//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2023 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import configuration from "../configuration";
import { Version } from "../utilities/version";
import { SwiftToolchain } from "../toolchain/toolchain";

/**
 * The launch configuration type added by the Swift extension that will delegate to the appropriate
 * LLDB debug adapter when launched.
 */
export const SWIFT_LAUNCH_CONFIG_TYPE = "swift";

/**
 * The supported {@link vscode.DebugConfiguration.type Debug Configuration Types} that can handle
 * LLDB launch requests.
 */
export const enum LaunchConfigType {
    LLDB_DAP = "lldb-dap",
    CODE_LLDB = "lldb",
}

/**
 * Class managing which debug adapter we are using. Will only setup lldb-vscode/lldb-dap if it is available.
 */
export class DebugAdapter {
    /**
     * Return the launch configuration type for the given Swift version. This also takes
     * into account user settings when determining which launch configuration to use.
     *
     * @param swiftVersion the version of the Swift toolchain
     * @returns the type of launch configuration used by the given Swift toolchain version
     */
    public static getLaunchConfigType(swiftVersion: Version): LaunchConfigType {
        const lldbDapIsAvailable = swiftVersion.isGreaterThanOrEqual(new Version(6, 0, 0));
        if (lldbDapIsAvailable && configuration.debugger.debugAdapter === "lldb-dap") {
            return LaunchConfigType.LLDB_DAP;
        } else {
            return LaunchConfigType.CODE_LLDB;
        }
    }

    /**
     * Return the path to the debug adapter.
     *
     * @param toolchain The Swift toolchain to use
     * @returns A path to the debug adapter for the user's toolchain and configuration
     **/
    public static async getLLDBDebugAdapterPath(toolchain: SwiftToolchain): Promise<string> {
        const customDebugAdapterPath = configuration.debugger.customDebugAdapterPath;
        if (customDebugAdapterPath.length > 0) {
            return customDebugAdapterPath;
        }
        return toolchain.getLLDBDebugAdapter();
    }
}
