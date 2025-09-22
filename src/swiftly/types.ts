import { z } from "zod/v4/mini";

import { Result } from "../utilities/result";
import { SwiftlyError } from "./SwiftlyError";

export const SwiftlyList = z.object({
    toolchains: z.array(
        z.object({
            inUse: z.boolean(),
            isDefault: z.boolean(),
            version: z.union([
                z.object({
                    type: z.literal("stable"),
                    name: z.string(),
                    major: z.optional(z.number()),
                    minor: z.optional(z.number()),
                    patch: z.optional(z.number()),
                }),
                z.object({
                    type: z.literal("snapshot"),
                    name: z.string(),
                    major: z.optional(z.number()),
                    minor: z.optional(z.number()),
                    branch: z.string(),
                    date: z.string(),
                }),
                z.object({
                    type: z.string(),
                    name: z.string(),
                }),
            ]),
        })
    ),
});

export const InUseVersionResult = z.object({
    version: z.string(),
});

const StableVersion = z.object({
    type: z.literal("stable"),
    name: z.string(),
    major: z.number(),
    minor: z.number(),
    patch: z.number(),
});

export type StableVersion = z.infer<typeof StableVersion>;

const SnapshotVersion = z.object({
    type: z.literal("snapshot"),
    name: z.string(),
    major: z.union([z.number(), z.undefined()]),
    minor: z.union([z.number(), z.undefined()]),
    branch: z.string(),
    date: z.string(),
});

export type SnapshotVersion = z.infer<typeof SnapshotVersion>;

const AvailableToolchain = z.object({
    inUse: z.boolean(),
    installed: z.boolean(),
    isDefault: z.boolean(),
    version: z.discriminatedUnion("type", [StableVersion, SnapshotVersion]),
});

export type AvailableToolchain = z.infer<typeof AvailableToolchain>;

export function isStableVersion(
    version: StableVersion | SnapshotVersion
): version is StableVersion {
    return version.type === "stable";
}

export function isSnapshotVersion(
    version: StableVersion | SnapshotVersion
): version is SnapshotVersion {
    return version.type === "snapshot";
}

export const ListAvailable = z.object({
    toolchains: z.array(AvailableToolchain),
});

export interface SwiftlyProgressData {
    step?: {
        text?: string;
        timestamp?: number;
        percent?: number;
    };
}

export interface PostInstallValidationResult {
    isValid: boolean;
    summary: string;
    invalidCommands?: string[];
}

export type SwiftlyResult<T> = Result<T, SwiftlyError>;
