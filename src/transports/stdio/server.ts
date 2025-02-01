import { StdioServerTransport as SDKStdioTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BaseTransport } from "../base.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * StdioServerTransport that implements BaseTransport
 */
export class StdioServerTransport implements BaseTransport {
  readonly type = "stdio";
  private transport: SDKStdioTransport;
  private running: boolean = false;

  constructor() {
    this.transport = new SDKStdioTransport();
  }

  async start(): Promise<void> {
    await this.transport.start();
    this.running = true;
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await this.transport.send(message);
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  set onclose(handler: (() => void) | undefined) {
    this.transport.onclose = handler;
  }

  set onerror(handler: ((error: Error) => void) | undefined) {
    this.transport.onerror = handler;
  }

  set onmessage(handler: ((message: JSONRPCMessage) => void) | undefined) {
    this.transport.onmessage = handler;
  }
}
