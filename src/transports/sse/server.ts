import { randomUUID } from "node:crypto";
import { IncomingMessage, Server as HttpServer, ServerResponse, createServer } from "node:http";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import contentType from "content-type";
import getRawBody from "raw-body";
import { AbstractTransport } from "../base.js";
import { DEFAULT_SSE_CONFIG, SSETransportConfig, SSETransportConfigInternal } from "./types.js";
import { logger } from "../../core/Logger.js";

/**
 * Server transport implementation using Server-Sent Events (SSE)
 */
export class SSEServerTransport extends AbstractTransport {
  readonly type = "sse";

  private _server?: HttpServer;
  private _sseResponse?: ServerResponse;
  private _sessionId: string;
  private _config: SSETransportConfigInternal;

  constructor(config: SSETransportConfig = {}) {
    super();
    this._sessionId = randomUUID();
    this._config = {
      ...DEFAULT_SSE_CONFIG,
      ...config
    };
    logger.debug(`SSE transport configured with: ${JSON.stringify(this._config)}`);
  }

  async start(): Promise<void> {
    if (this._server) {
      throw new Error("SSE transport already started");
    }

    return new Promise((resolve) => {
      this._server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (error) {
          logger.error(`Error handling request: ${error}`);
          res.writeHead(500).end("Internal Server Error");
        }
      });

      this._server.listen(this._config.port, () => {
        logger.info(`SSE transport listening on port ${this._config.port}`);
        resolve();
      });

      this._server.on("error", (error) => {
        logger.error(`SSE server error: ${error}`);
        this._onerror?.(error);
      });

      // Keep server running
      this._server.on("close", () => {
        logger.info("SSE server closed");
        this._onclose?.();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("sessionId");

    if (req.method === "GET" && url.pathname === this._config.endpoint) {
      if (this._sseResponse?.writableEnded) {
        this._sseResponse = undefined;
      }

      if (this._sseResponse) {
        res.writeHead(409).end("SSE connection already established");
        return;
      }

      this.setupSSEConnection(res);
      return;
    }

    if (req.method === "POST" && url.pathname === this._config.messageEndpoint) {
      if (sessionId !== this._sessionId) {
        res.writeHead(403).end("Invalid session ID");
        return;
      }

      await this.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404).end("Not Found");
  }

  private setupSSEConnection(res: ServerResponse): void {
    const headers = {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...this._config.headers
    };

    res.writeHead(200, headers);

    res.write(`event: endpoint\ndata: ${this._config.messageEndpoint}?sessionId=${this._sessionId}\n\n`);

    this._sseResponse = res;
    res.on("close", () => {
      logger.info("SSE connection closed");
      this._sseResponse = undefined;
    });

    res.on("error", () => {
      logger.info("SSE connection error");
      this._sseResponse = undefined;
    });

    res.on("end", () => {
      logger.info("SSE connection ended");
      this._sseResponse = undefined;
    });
  }

  private async handlePostMessage(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this._sseResponse || this._sseResponse.writableEnded) {
      res.writeHead(409).end("SSE connection not established");
      return;
    }

    try {
      const ct = contentType.parse(req.headers["content-type"] ?? "");
      if (ct.type !== "application/json") {
        throw new Error(`Unsupported content-type: ${ct.type}`);
      }

      const rawBody = await getRawBody(req, {
        limit: this._config.maxMessageSize,
        encoding: ct.parameters.charset ?? "utf-8"
      });

      const message = JSON.parse(rawBody.toString());
      this._onmessage?.(message);
      res.writeHead(202).end("Accepted");
    } catch (error) {
      logger.error(`Error handling message: ${error}`);
      res.writeHead(400).end(String(error));
      this._onerror?.(error as Error);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._sseResponse || this._sseResponse.writableEnded) {
      throw new Error("SSE connection not established");
    }

    this._sseResponse.write(`data: ${JSON.stringify(message)}\n\n`);
  }

  async close(): Promise<void> {
    if (this._sseResponse && !this._sseResponse.writableEnded) {
      this._sseResponse.end();
    }
    this._sseResponse = undefined;
    
    return new Promise((resolve) => {
      if (!this._server) {
        resolve();
        return;
      }

      this._server.close(() => {
        logger.info("SSE server stopped");
        this._server = undefined;
        this._onclose?.();
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return Boolean(this._server);
  }
}
