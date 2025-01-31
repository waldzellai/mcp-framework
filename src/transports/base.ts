import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Base transport interface that all MCP Framework transports must implement.
 * Extends the SDK's Transport interface with framework-specific additions.
 */
export interface BaseTransport extends Transport {
  /**
   * The type of transport (e.g., "stdio", "sse")
   */
  readonly type: string;

  /**
   * Returns whether the transport is currently running
   */
  isRunning(): boolean;
}

/**
 * Abstract base class for transports that implements common functionality
 */
export abstract class AbstractTransport implements BaseTransport {
  abstract readonly type: string;

  protected _onclose?: () => void;
  protected _onerror?: (error: Error) => void;
  protected _onmessage?: (message: JSONRPCMessage) => void;

  set onclose(handler: (() => void) | undefined) {
    this._onclose = handler;
  }

  set onerror(handler: ((error: Error) => void) | undefined) {
    this._onerror = handler;
  }

  set onmessage(handler: ((message: JSONRPCMessage) => void) | undefined) {
    this._onmessage = handler;
  }

  abstract start(): Promise<void>;
  abstract send(message: JSONRPCMessage): Promise<void>;
  abstract close(): Promise<void>;
  abstract isRunning(): boolean;
}
