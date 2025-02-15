import { randomUUID } from "node:crypto"
import { IncomingMessage, Server as HttpServer, ServerResponse, createServer } from "node:http"
import { JSONRPCMessage, ClientRequest } from "@modelcontextprotocol/sdk/types.js"
import contentType from "content-type"
import getRawBody from "raw-body"
import { APIKeyAuthProvider } from "../../auth/providers/apikey.js"
import { DEFAULT_AUTH_ERROR } from "../../auth/types.js"
import { AbstractTransport } from "../base.js"
import { DEFAULT_SSE_CONFIG, SSETransportConfig, SSETransportConfigInternal, DEFAULT_CORS_CONFIG, CORSConfig } from "./types.js"
import { logger } from "../../core/Logger.js"
import { getRequestHeader, setResponseHeaders } from "../../utils/headers.js"

interface ExtendedIncomingMessage extends IncomingMessage {
  body?: ClientRequest
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive"
}

export class SSEServerTransport extends AbstractTransport {
  readonly type = "sse"

  private _server?: HttpServer
  private _sseResponse?: ServerResponse
  private _sessionId: string
  private _config: SSETransportConfigInternal
  private _keepAliveInterval?: NodeJS.Timeout

  constructor(config: SSETransportConfig = {}) {
    super()
    this._sessionId = randomUUID()
    this._config = {
      ...DEFAULT_SSE_CONFIG,
      ...config
    }
    logger.debug(`SSE transport configured with: ${JSON.stringify({
      ...this._config,
      auth: this._config.auth ? {
        provider: this._config.auth.provider.constructor.name,
        endpoints: this._config.auth.endpoints
      } : undefined
    })}`)
  }

  private getCorsHeaders(includeMaxAge: boolean = false): Record<string, string> {
    // Ensure all CORS properties are present by merging with defaults
    const corsConfig = {
      allowOrigin: DEFAULT_CORS_CONFIG.allowOrigin,
      allowMethods: DEFAULT_CORS_CONFIG.allowMethods,
      allowHeaders: DEFAULT_CORS_CONFIG.allowHeaders,
      exposeHeaders: DEFAULT_CORS_CONFIG.exposeHeaders,
      maxAge: DEFAULT_CORS_CONFIG.maxAge,
      ...this._config.cors
    } as Required<CORSConfig>

    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": corsConfig.allowOrigin,
      "Access-Control-Allow-Methods": corsConfig.allowMethods,
      "Access-Control-Allow-Headers": corsConfig.allowHeaders,
      "Access-Control-Expose-Headers": corsConfig.exposeHeaders
    }

    if (includeMaxAge) {
      headers["Access-Control-Max-Age"] = corsConfig.maxAge
    }

    return headers
  }

  async start(): Promise<void> {
    if (this._server) {
      throw new Error("SSE transport already started")
    }

    return new Promise((resolve) => {
      this._server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res)
        } catch (error) {
          logger.error(`Error handling request: ${error}`)
          res.writeHead(500).end("Internal Server Error")
        }
      })

      this._server.listen(this._config.port, () => {
        logger.info(`SSE transport listening on port ${this._config.port}`)
        resolve()
      })

      this._server.on("error", (error) => {
        logger.error(`SSE server error: ${error}`)
        this._onerror?.(error)
      })

      this._server.on("close", () => {
        logger.info("SSE server closed")
        this._onclose?.()
      })
    })
  }

  private async handleRequest(req: ExtendedIncomingMessage, res: ServerResponse): Promise<void> {
    logger.debug(`Incoming request: ${req.method} ${req.url}`)

    if (req.method === "OPTIONS") {
      setResponseHeaders(res, this.getCorsHeaders(true))
      res.writeHead(204).end()
      return
    }

    setResponseHeaders(res, this.getCorsHeaders())

    const url = new URL(req.url!, `http://${req.headers.host}`)
    const sessionId = url.searchParams.get("sessionId")

    if (req.method === "GET" && url.pathname === this._config.endpoint) {
      if (this._config.auth?.endpoints?.sse) {
        const isAuthenticated = await this.handleAuthentication(req, res, "SSE connection")
        if (!isAuthenticated) return
      }

      if (this._sseResponse?.writableEnded) {
        this._sseResponse = undefined
      }
  
      if (this._sseResponse) {
        logger.warn("SSE connection already established")
        res.writeHead(409).end("SSE connection already established")
        return
      }
  
      this.setupSSEConnection(res)
      return
    }

    if (req.method === "POST" && url.pathname === this._config.messageEndpoint) {
      if (sessionId !== this._sessionId) {
        logger.warn(`Invalid session ID received: ${sessionId}, expected: ${this._sessionId}`)
        res.writeHead(403).end("Invalid session ID")
        return
      }

      if (this._config.auth?.endpoints?.messages !== false) {
        const isAuthenticated = await this.handleAuthentication(req, res, "message")
        if (!isAuthenticated) return
      }

      await this.handlePostMessage(req, res)
      return
    }

    res.writeHead(404).end("Not Found")
  }

  private async handleAuthentication(req: ExtendedIncomingMessage, res: ServerResponse, context: string): Promise<boolean> {
    if (!this._config.auth?.provider) {
      return true
    }

    const isApiKey = this._config.auth.provider instanceof APIKeyAuthProvider
    if (isApiKey) {
      const provider = this._config.auth.provider as APIKeyAuthProvider
      const headerValue = getRequestHeader(req.headers, provider.getHeaderName())
      
      if (!headerValue) {
        const error = provider.getAuthError?.() || DEFAULT_AUTH_ERROR
        res.setHeader("WWW-Authenticate", `ApiKey realm="MCP Server", header="${provider.getHeaderName()}"`)
        res.writeHead(error.status).end(JSON.stringify({
          error: error.message,
          status: error.status,
          type: "authentication_error"
        }))
        return false
      }
    }

    const authResult = await this._config.auth.provider.authenticate(req)
    if (!authResult) {
      const error = this._config.auth.provider.getAuthError?.() || DEFAULT_AUTH_ERROR
      logger.warn(`Authentication failed for ${context}:`)
      logger.warn(`- Client IP: ${req.socket.remoteAddress}`)
      logger.warn(`- Error: ${error.message}`)

      if (isApiKey) {
        const provider = this._config.auth.provider as APIKeyAuthProvider
        res.setHeader("WWW-Authenticate", `ApiKey realm="MCP Server", header="${provider.getHeaderName()}"`)
      }
      
      res.writeHead(error.status).end(JSON.stringify({
        error: error.message,
        status: error.status,
        type: "authentication_error"
      }))
      return false
    }

    logger.info(`Authentication successful for ${context}:`)
    logger.info(`- Client IP: ${req.socket.remoteAddress}`)
    logger.info(`- Auth Type: ${this._config.auth.provider.constructor.name}`)
    return true
  }

  private setupSSEConnection(res: ServerResponse): void {
    logger.debug(`Setting up SSE connection for session: ${this._sessionId}`);
    
    const headers = {
      ...SSE_HEADERS,
      ...this.getCorsHeaders(),
      ...this._config.headers
    }
    setResponseHeaders(res, headers)
    logger.debug(`SSE headers set: ${JSON.stringify(headers)}`);

    if (res.socket) {
      res.socket.setNoDelay(true)        
      res.socket.setTimeout(0)            
      res.socket.setKeepAlive(true, 1000) 
      logger.debug('Socket optimized for SSE connection');
    }

    const endpointUrl = `${this._config.messageEndpoint}?sessionId=${this._sessionId}`;
    logger.debug(`Sending endpoint URL: ${endpointUrl}`);
    res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);
    
    logger.debug('Sending initial keep-alive');
    res.write(": keep-alive\n\n");

    this._keepAliveInterval = setInterval(() => {
      if (this._sseResponse && !this._sseResponse.writableEnded) {
        try {
          logger.debug('Sending keep-alive ping');
          this._sseResponse.write(": keep-alive\n\n");
          
          const pingMessage = {
            jsonrpc: "2.0",
            method: "ping",
            params: { timestamp: Date.now() }
          };
          this._sseResponse.write(`data: ${JSON.stringify(pingMessage)}\n\n`);
        } catch (error) {
          logger.error(`Error sending keep-alive: ${error}`);
          this.cleanupConnection();
        }
      }
    }, 15000) 

    this._sseResponse = res

    const cleanup = () => this.cleanupConnection()

    res.on("close", () => {
      logger.info(`SSE connection closed for session: ${this._sessionId}`)
      cleanup()
    })

    res.on("error", (error) => {
      logger.error(`SSE connection error for session ${this._sessionId}: ${error}`)
      this._onerror?.(error)
      cleanup()
    })

    res.on("end", () => {
      logger.info(`SSE connection ended for session: ${this._sessionId}`)
      cleanup()
    })

    logger.info(`SSE connection established successfully for session: ${this._sessionId}`)
  }

  private async handlePostMessage(req: ExtendedIncomingMessage, res: ServerResponse): Promise<void> {
    if (!this._sseResponse || this._sseResponse.writableEnded) {
      logger.warn(`Rejecting message: no active SSE connection for session ${this._sessionId}`)
      res.writeHead(409).end("SSE connection not established")
      return
    }

    let currentMessage: { id?: string | number; method?: string } = {}

    try {
      const rawMessage = req.body || await (async () => {
        const ct = contentType.parse(req.headers["content-type"] ?? "")
        if (ct.type !== "application/json") {
          throw new Error(`Unsupported content-type: ${ct.type}`)
        }
        const rawBody = await getRawBody(req, {
          limit: this._config.maxMessageSize,
          encoding: ct.parameters.charset ?? "utf-8"
        })
        const parsed = JSON.parse(rawBody.toString())
        logger.debug(`Received message: ${JSON.stringify(parsed)}`)
        return parsed
      })()

      const { id, method, params } = rawMessage as any;
      logger.debug(`Parsed message - ID: ${id}, Method: ${method}`);

      const rpcMessage: JSONRPCMessage = {
        jsonrpc: "2.0",
        id: id,
        method: method,
        params: params
      };

      currentMessage = {
        id: id,
        method: method
      };

      logger.debug(`Processing RPC message: ${JSON.stringify({
        id: id,
        method: method,
        params: params
      })}`);

      if (!this._onmessage) {
        throw new Error("No message handler registered")
      }

      await this._onmessage(rpcMessage)
      
      res.writeHead(202).end("Accepted")
      
      logger.debug(`Successfully processed message ${rpcMessage.id}`)

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error(`Error handling message for session ${this._sessionId}:`)
      logger.error(`- Error: ${errorMessage}`)
      logger.error(`- Method: ${currentMessage.method || "unknown"}`)
      logger.error(`- Message ID: ${currentMessage.id || "unknown"}`)

      const errorResponse = {
        jsonrpc: "2.0",
        id: currentMessage.id || null,
        error: {
          code: -32000,
          message: errorMessage,
          data: {
            method: currentMessage.method || "unknown",
            sessionId: this._sessionId,
            connectionActive: Boolean(this._sseResponse),
            type: "message_handler_error"
          }
        }
      }

      res.writeHead(400).end(JSON.stringify(errorResponse))
      this._onerror?.(error as Error)
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this._sseResponse || this._sseResponse.writableEnded) {
      throw new Error("SSE connection not established")
    }

    this._sseResponse.write(`data: ${JSON.stringify(message)}\n\n`)
  }

  async close(): Promise<void> {
    if (this._sseResponse && !this._sseResponse.writableEnded) {
      this._sseResponse.end()
    }
    
    this.cleanupConnection()
    
    return new Promise((resolve) => {
      if (!this._server) {
        resolve()
        return
      }

      this._server.close(() => {
        logger.info("SSE server stopped")
        this._server = undefined
        this._onclose?.()
        resolve()
      })
    })
  }

  /**
   * Clean up SSE connection resources
   */
  private cleanupConnection(): void {
    if (this._keepAliveInterval) {
      clearInterval(this._keepAliveInterval)
      this._keepAliveInterval = undefined
    }
    this._sseResponse = undefined
  }

  isRunning(): boolean {
    return Boolean(this._server)
  }
}
