// Winston work off of "any" as meta data so creating this
// type so we don't have to disable ESLint many times below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LoggerMeta = any;
export type LogMessageOptions = { append: boolean };

export interface Logger {
    debug(message: LoggerMeta, label?: string, options?: LogMessageOptions): void;

    info(message: LoggerMeta, label?: string, options?: LogMessageOptions): void;

    warn(message: LoggerMeta, label?: string, options?: LogMessageOptions): void;

    error(message: LoggerMeta, label?: string, options?: LogMessageOptions): void;
}
