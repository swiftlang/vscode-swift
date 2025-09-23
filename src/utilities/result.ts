//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2022 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

/**
 * Wrapper class for a Result that might contain either success or failure
 */
export class Result<Success, Failure> {
    get value(): Success | undefined {
        if (this.state.type === "failure") {
            return undefined;
        }
        return this.state.value;
    }

    get error(): Failure | undefined {
        if (this.state.type === "failure") {
            return this.state.error;
        }
        return undefined;
    }

    private constructor(
        private readonly state: SuccessfulResult<Success> | FailedResult<Failure>
    ) {}

    /** Return a successful result */
    static success<Success>(success: Success): Result<Success, never> {
        return new Result({ type: "success", value: success });
    }

    /** Return a failed result */
    static failure<Failure>(failure: Failure): Result<never, Failure> {
        return new Result<never, Failure>({ type: "failure", error: failure });
    }

    /**
     * Returns the success value as a throwing expression.
     *
     * @returns The success value, if the instance represents a success.
     * @throws The failure error, if the instance represents a failure.
     */
    getOrThrow(): Success {
        if (this.state.type === "failure") {
            throw this.state.error;
        }
        return this.state.value;
    }

    map<NewSuccess>(transform: (result: Success) => NewSuccess): Result<NewSuccess, Failure> {
        if (this.state.type === "failure") {
            return Result.failure(this.state.error);
        }
        const newSuccess = transform(this.state.value);
        return Result.success(newSuccess);
    }

    mapError<NewFailure>(transform: (error: Failure) => NewFailure): Result<Success, NewFailure> {
        if (this.state.type === "failure") {
            return Result.failure(transform(this.state.error));
        }
        return Result.success(this.state.value);
    }

    flatMap<NewSuccess>(
        transform: (result: Success) => Result<NewSuccess, Failure>
    ): Result<NewSuccess, Failure> {
        if (this.state.type === "failure") {
            return Result.failure(this.state.error);
        }
        return transform(this.state.value);
    }

    flatMapError<NewFailure>(
        transform: (error: Failure) => Result<Success, NewFailure>
    ): Result<Success, NewFailure> {
        if (this.state.type === "failure") {
            return transform(this.state.error);
        }
        return Result.success(this.state.value);
    }

    onSuccess(onSuccess: (value: Success) => void): Result<Success, Failure> {
        if (this.state.type === "success") {
            onSuccess(this.state.value);
        }
        return this;
    }

    onError(onError: (error: Failure) => void): Result<Success, Failure> {
        if (this.state.type === "failure") {
            onError(this.state.error);
        }
        return this;
    }

    ignoreError(): Result<Success | undefined, never> {
        if (this.state.type === "failure") {
            return Result.success(undefined);
        }
        return Result.success(this.state.value);
    }
}

interface SuccessfulResult<T> {
    type: "success";
    value: T;
}

interface FailedResult<T> {
    type: "failure";
    error: T;
}
