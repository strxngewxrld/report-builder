// Test hook for the integration tests (test/integration). Only active when BC_REPORT_BUILDER_TEST=1:
// records the messages exchanged with each designer webview and lets tests inject webview messages.

export const testing = process.env.BC_REPORT_BUILDER_TEST === '1';

export interface EditorProbe {
  /** Messages received from the (real) webview. */
  received: { type: string; [k: string]: unknown }[];
  /** Messages the extension posted to the webview. */
  posted: { type: string; [k: string]: unknown }[];
  /** Handles a message as if the webview had sent it. */
  /** Send a structured message to the real webview (DOM integration driver). */
  send(msg: { type: string; [k: string]: unknown }): Thenable<boolean>;
  deliver(msg: { type: string; [k: string]: unknown }): Promise<void>;
}

/** Probes by document URI (string). */
export const probes = new Map<string, EditorProbe>();
