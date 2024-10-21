import { WebviewEvent } from "./events";

declare global {
    interface VSCodeWebviewAPI {
        getState(): WebviewState | null | undefined;
        setState(value: WebviewState): void;
        postMessage(event: WebviewEvent): void;
    }

    function acquireVsCodeApi(): VSCodeWebviewAPI;
}

export interface WebviewState {
    location?: string;
    scrollPosition: {
        x: number;
        y: number;
    };
}
