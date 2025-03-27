import { randomUUID } from "node:crypto";
import { IncomingMessage, Server as HttpServer, ServerResponse, createServer } from "node:http";
import {
    JsonRpcMessage,
    JsonRpcRequest,
    JsonRpcNotification,
    JsonRpcSuccessResponse,
    JsonRpcErrorResponse,
    JsonRpcError,
    JsonRpcId 
} from "./types.js";

import contentType from "content-type";
import getRawBody from "raw-body";

import { AbstractTransport } from "../base.js";
import { DEFAULT_HTTP_STREAM_CONFIG, HttpStreamTransportConfig, HttpStreamTransportConfigInternal, SessionData, ActiveSseConnection, BatchResponseState } from "./types.js";
import { AuthProvider, AuthResult, DEFAULT_AUTH_ERROR } from "../../auth/types.js";
import { logger } from "../../core/Logger.js";
import { getRequestHeader, setResponseHeaders } from "../../utils/headers.js";
import { DEFAULT_CORS_CONFIG } from "../sse/types.js";


function isRequest(msg: any): msg is JsonRpcRequest {
  return msg && typeof msg.method === 'string' && msg.jsonrpc === "2.0" && 'id' in msg && msg.id !== null && !('result' in msg || 'error' in msg);
}


function isNotification(msg: any): msg is JsonRpcNotification {
  return msg && typeof msg.method === 'string' && msg.jsonrpc === "2.0" && !('id' in msg);
}


function isSuccessResponse(msg: any): msg is JsonRpcSuccessResponse {
  return msg && msg.jsonrpc === "2.0" && 'id' in msg && 'result' in msg && !('error' in msg);
}


function isErrorResponse(msg: any): msg is JsonRpcErrorResponse {
  return msg && msg.jsonrpc === "2.0" && 'id' in msg && 'error' in msg && !('result' in msg);
}


function isResponse(msg: any): msg is JsonRpcSuccessResponse | JsonRpcErrorResponse {
    return isSuccessResponse(msg) || isErrorResponse(msg);
}


const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};
const JSON_CONTENT_TYPE = "application/json";
const SSE_CONTENT_TYPE = "text/event-stream";

export class HttpStreamTransport extends AbstractTransport {
  readonly type = "http-stream";

  private _server?: HttpServer;
  private _config: HttpStreamTransportConfigInternal;
  private _activeSessions = new Map<string, SessionData>();
  private _activeSseConnections = new Set<ActiveSseConnection>();
  private _requestStreamMap = new Map<string | number, ActiveSseConnection>();
  private _pendingBatches = new Map<ServerResponse, BatchResponseState>();
  private _eventCounter = 0;

  constructor(config: HttpStreamTransportConfig = {}) {
    super();
    this._config = {
      ...DEFAULT_HTTP_STREAM_CONFIG,
      ...config,
      session: { ...DEFAULT_HTTP_STREAM_CONFIG.session, ...config.session },
      resumability: { ...DEFAULT_HTTP_STREAM_CONFIG.resumability, ...config.resumability },
      cors: { ...DEFAULT_CORS_CONFIG, ...(config.cors || {}) } as Required<NonNullable<HttpStreamTransportConfig['cors']>>,
      auth: config.auth ?? DEFAULT_HTTP_STREAM_CONFIG.auth,
      headers: config.headers ?? DEFAULT_HTTP_STREAM_CONFIG.headers,
    };

    if (this._config.auth?.endpoints) {
        logger.warn("Auth 'endpoints' config ignored for HttpStreamTransport.");
    }
    
    logger.debug(`HttpStreamTransport configured: ${JSON.stringify({
      port: this._config.port, 
      endpoint: this._config.endpoint, 
      responseMode: this._config.responseMode,
      sessionEnabled: this._config.session.enabled, 
      resumabilityEnabled: this._config.resumability.enabled,
      authEnabled: !!this._config.auth, 
      corsOrigin: this._config.cors.allowOrigin
    }, null, 2)}`);
  }


  private getCorsHeaders(req: IncomingMessage, includeMaxAge: boolean = false): Record<string, string> {
    const corsConfig = this._config.cors;
    const headers: Record<string, string> = {
      "Access-Control-Allow-Origin": corsConfig.allowOrigin || req.headers.origin || '*',
      "Access-Control-Allow-Methods": corsConfig.allowMethods,
      "Access-Control-Allow-Headers": corsConfig.allowHeaders,
      "Access-Control-Expose-Headers": [corsConfig.exposeHeaders, this._config.session.enabled ? this._config.session.headerName : null].filter(Boolean).join(', '),
      "Access-Control-Allow-Credentials": "true",
    };
    if (req.headers.origin && corsConfig.allowOrigin !== '*') {
        headers['Vary'] = 'Origin';
    }
    if (includeMaxAge) {
      headers["Access-Control-Max-Age"] = corsConfig.maxAge;
    }
    return headers;
  }

  async start(): Promise<void> {
     if (this._server) {
      throw new Error("HttpStreamTransport already started");
    }
    return new Promise((resolve, reject) => {
      this._server = createServer(async (req, res) => {
        if (this._config.headers) setResponseHeaders(res, this._config.headers);
        try {
          await this.handleRequest(req, res);
        } catch (error: any) {
          logger.error(`Unhandled error in handleRequest: ${error?.message || error}\n${error?.stack}`);
          if (!res.headersSent) res.writeHead(error.statusCode || 500, { "Content-Type": JSON_CONTENT_TYPE });
          if (!res.writableEnded) res.end(JSON.stringify({ jsonrpc: "2.0", id: error.requestId || null, error: { code: error.code || -32000, message: error.message || "Internal Server Error", data: error.data } }));
        }
      });
      this._server.on("error", (error) => {
        logger.error(`HttpStream server error: ${error}`);
        this._onerror?.(error);
        if (!this.isRunning()) reject(error);
      });
      this._server.on("close", () => {
        logger.info("HttpStream server closed");
        this.cleanupAllConnections();
        this._onclose?.();
      });
      this._server.listen(this._config.port, () => {
        const address = this._server?.address();
        if (address) {
            logger.info(`HttpStream transport listening on port ${this._config.port}, endpoint ${this._config.endpoint}`);
            resolve();
        } else {
            const listenError = new Error(`Server failed to listen on port ${this._config.port}`);
            logger.error(listenError.message);
            reject(listenError);
        }
      });
    });
  }



  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    logger.debug(`Incoming request: ${req.method} ${url.pathname}`);
    if (req.method === "OPTIONS") {
      setResponseHeaders(res, this.getCorsHeaders(req, true));
      res.writeHead(204).end();
      logger.debug(`Responded to OPTIONS request for ${url.pathname}`);
      return;
    }
    setResponseHeaders(res, this.getCorsHeaders(req));
    if (url.pathname !== this._config.endpoint) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end("Not Found");
      logger.warn(`Request to unknown path: ${url.pathname}`); return;
    }
    try {
        switch (req.method) {
          case "POST": await this.handlePost(req, res); break;
          case "GET": await this.handleGet(req, res); break;
          case "DELETE": await this.handleDelete(req, res); break;
          default:
             res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'GET, POST, DELETE, OPTIONS' }); res.end("Method Not Allowed");
             logger.warn(`Unsupported method: ${req.method}`); break;
        }
    } catch (error: any) {
        logger.error(`Error processing ${req.method} ${url.pathname}: ${error.message}`);
        if (!res.headersSent) res.writeHead(error.statusCode || 500, { 'Content-Type': JSON_CONTENT_TYPE });
        if (!res.writableEnded) res.end(JSON.stringify({ jsonrpc: "2.0", id: error.requestId || null, error: { code: error.code || -32000, message: error.message || 'Internal Server Error', data: error.data } }));
    }
  }



  private async handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    logger.debug(`Handling POST request to ${this._config.endpoint}`);
    let messages: any[];
    let parsedMessages: JsonRpcMessage[]; 
    let firstRequestId: JsonRpcId = null;

    const reqContentTypeHeader = req.headers["content-type"];
    if (!reqContentTypeHeader) throw this.httpError(415, 'Unsupported Media Type: Content-Type header missing');
    const reqContentType = contentType.parse(reqContentTypeHeader);
    if (reqContentType.type !== JSON_CONTENT_TYPE) throw this.httpError(415, `Unsupported Media Type: Content-Type must be ${JSON_CONTENT_TYPE}`);

    const acceptHeader = req.headers.accept || '';
    const acceptsJson = acceptHeader.includes(JSON_CONTENT_TYPE) || acceptHeader.includes('*/*');
    const acceptsSse = acceptHeader.includes(SSE_CONTENT_TYPE) || acceptHeader.includes('*/*');
    if (!acceptsJson || !acceptsSse) {
         logger.error(`POST request rejected: Accept header ('${acceptHeader}') missing required types (${JSON_CONTENT_TYPE} and ${SSE_CONTENT_TYPE})`);
         throw this.httpError(406, `Not Acceptable: Accept header must include ${JSON_CONTENT_TYPE} and ${SSE_CONTENT_TYPE}`);
    }

    try {
      const rawBody = await getRawBody(req, { limit: this._config.maxMessageSize, encoding: reqContentType.parameters.charset ?? "utf-8" });
      const parsed = JSON.parse(rawBody.toString());
      messages = Array.isArray(parsed) ? parsed : [parsed];
      if (messages.length === 0) throw new Error('Empty JSON array received');

      parsedMessages = messages.map((msg, index) => {
          if (!msg || typeof msg !== 'object' || msg.jsonrpc !== "2.0") {
              throw new Error(`Invalid JSON-RPC structure at index ${index}`);
          }
          if (firstRequestId === null && 'id' in msg && msg.id !== null) {
             firstRequestId = msg.id;
          }
          return msg as JsonRpcMessage; 
      });
      logger.debug(`Parsed ${parsedMessages.length} message(s) from POST body`);
    } catch (e: any) {
      logger.error(`Failed to parse POST body: ${e.message}`);
      throw this.httpError(400, `Bad Request: ${e.message}`, -32700, undefined, firstRequestId);
    }

    const isInitialize = parsedMessages.some(msg => isRequest(msg) && msg.method === 'initialize');
    const sessionIdHeader = getRequestHeader(req.headers, this._config.session.headerName);
    let session: SessionData | undefined;
    if (this._config.session.enabled) {
        if (isInitialize) {
            if (sessionIdHeader) throw this.httpError(400, 'Bad Request: Cannot send session ID with initialize request', -32600, undefined, firstRequestId);
        } else {
            session = this.validateSession(sessionIdHeader, req, true, firstRequestId);
            session.lastActivity = Date.now();
        }
    }

    const authContext = isInitialize ? "initialize" : `session ${session?.id || 'N/A'}`;
    await this.handleAuthentication(req, res, `POST ${authContext}`, session, firstRequestId);

    const clientRequests = parsedMessages.filter(isRequest);
    const clientNotifications = parsedMessages.filter(isNotification);
    const clientResponses = parsedMessages.filter(isResponse);

    [...clientNotifications, ...clientResponses].forEach(msg => {
        this.handleIncomingMessage(msg, session?.id);
    });

    if (clientRequests.length === 0) {
      res.writeHead(202).end(); logger.debug("POST contained only notifications/responses, sent 202 Accepted.");
    } else {
      const responseMode = this._config.responseMode;
      logger.debug(`Processing ${clientRequests.length} requests with responseMode: ${responseMode}`);

      if (responseMode === 'batch') {
          const requestIds = new Set<string | number>();
          clientRequests.forEach(req => requestIds.add(req.id)); 

          if (requestIds.size === 0) {
              logger.error("Batch mode POST contained requests but none had valid IDs. Cannot track responses.");
              throw this.httpError(400, "Bad Request: Requests in batch mode must have valid non-null IDs", -32600, undefined, firstRequestId);
          }

          const batchState: BatchResponseState = {
              res, requestIds, responses: new Map(), isCompleted: false,
              timeoutId: setTimeout(() => this.handleBatchTimeout(res), this._config.batchTimeout),
          };
          this._pendingBatches.set(res, batchState);
          logger.debug(`Batch mode: Tracking ${requestIds.size} request IDs. Timeout: ${this._config.batchTimeout}ms.`);

          clientRequests.forEach(reqMsg => this.handleIncomingMessage(reqMsg, session?.id));

      } else {
          const sseConnection = this.setupSSEConnection(req, res, session?.id);
          if (isInitialize && this._config.session.enabled) {
              const newSessionId = randomUUID();
              session = { id: newSessionId, createdAt: Date.now(), lastActivity: Date.now() };
              this._activeSessions.set(newSessionId, session);
              sseConnection.sessionId = newSessionId;
              res.setHeader(this._config.session.headerName, newSessionId);
              logger.info(`Initialized new session: ${newSessionId} via stream`);
          }
          clientRequests.forEach(reqMsg => {
              this._requestStreamMap.set(reqMsg.id, sseConnection);
              this.handleIncomingMessage(reqMsg, session?.id);
          });
      }
    }
  }


  private handleBatchTimeout(res: ServerResponse): void {
      const batchState = this._pendingBatches.get(res);
      if (batchState && !batchState.isCompleted) {
          logger.error(`Batch response timed out after ${this._config.batchTimeout}ms. Sending error.`);
          batchState.isCompleted = true;

          const missingIds = Array.from(batchState.requestIds).filter(id => !batchState.responses.has(id));
          logger.warn(`Missing responses for request IDs: ${missingIds.join(', ')}`);

          const errorJson: JsonRpcError = {
              code: -32006,
              message: `Request batch timed out. Missing responses for ${missingIds.length} requests.`,
              data: { missingIds }
          };
          const finalResponse: JsonRpcErrorResponse = { jsonrpc: "2.0", id: null, error: errorJson };

          if (!res.headersSent) res.writeHead(504, { 'Content-Type': JSON_CONTENT_TYPE });
          if (!res.writableEnded) res.end(JSON.stringify(finalResponse));
          this._pendingBatches.delete(res);
      }
  }


  private completeBatchResponse(batchState: BatchResponseState): void {
       if (batchState.isCompleted) return;
       logger.debug(`Completing batch response. Collected ${batchState.responses.size}/${batchState.requestIds.size} responses.`);
       clearTimeout(batchState.timeoutId);
       batchState.isCompleted = true;

       const finalResponses = Array.from(batchState.responses.values());
       const body = JSON.stringify(finalResponses);

       if (!batchState.res.headersSent) {
            batchState.res.setHeader('Content-Type', JSON_CONTENT_TYPE);
            batchState.res.writeHead(200);
       }
       if (!batchState.res.writableEnded) batchState.res.end(body);
       this._pendingBatches.delete(batchState.res);
       logger.debug("Batch response sent successfully.");
  }

  private async handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
    logger.debug(`Handling GET request to ${this._config.endpoint}`);
    const acceptHeader = req.headers.accept || '';
    if (!acceptHeader.includes(SSE_CONTENT_TYPE) && !acceptHeader.includes('*/*')) throw this.httpError(406, `Not Acceptable: GET requires Accept header including ${SSE_CONTENT_TYPE}`);
    const sessionIdHeader = getRequestHeader(req.headers, this._config.session.headerName);
    let session: SessionData | undefined;
    if (this._config.session.enabled) { session = this.validateSession(sessionIdHeader, req, true); session.lastActivity = Date.now(); }
    await this.handleAuthentication(req, res, `GET session ${session?.id || 'N/A'}`, session);
    const lastEventId = getRequestHeader(req.headers, "Last-Event-ID");
    if (lastEventId && !this._config.resumability.enabled) logger.warn(`Client sent Last-Event-ID (${lastEventId}) but resumability is disabled.`);
    this.setupSSEConnection(req, res, session?.id, lastEventId);
    logger.debug(`Established SSE stream for GET request (Session: ${session?.id || 'N/A'})`);
  }


  private async handleDelete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    logger.debug(`Handling DELETE request to ${this._config.endpoint}`);
    if (!this._config.session.enabled) throw this.httpError(405, 'Method Not Allowed: Sessions are disabled');
    if (!this._config.session.allowClientTermination) throw this.httpError(405, 'Method Not Allowed: Client session termination is disabled');
    const sessionIdHeader = getRequestHeader(req.headers, this._config.session.headerName);
    const session = this.validateSession(sessionIdHeader, req, true);
    await this.handleAuthentication(req, res, `DELETE session ${session.id}`, session);
    this._activeSessions.delete(session.id);
    logger.info(`Terminated session ${session.id} via DELETE request.`);
    const streamsToClose = Array.from(this._activeSseConnections).filter(conn => conn.sessionId === session.id);
    streamsToClose.forEach(conn => this.cleanupConnection(conn, "Session terminated via DELETE"));
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end("Session terminated");
  }


  private setupSSEConnection(req: IncomingMessage, res: ServerResponse, sessionId?: string, lastEventId?: string): ActiveSseConnection {
    const streamId = randomUUID();
    const connection: ActiveSseConnection = {
        res, sessionId, streamId, lastEventIdSent: null,
        messageHistory: this._config.resumability.enabled ? [] : undefined, pingInterval: undefined
    };
    res.writeHead(200, { ...SSE_HEADERS });
    logger.debug(`SSE stream ${streamId} setup (Session: ${sessionId || 'N/A'})`);
    if (res.socket) { res.socket.setNoDelay(true); res.socket.setKeepAlive(true); res.socket.setTimeout(0); logger.debug(`Optimized socket for SSE stream ${streamId}`); }
    else { logger.warn(`Could not access socket for SSE stream ${streamId} to optimize.`); }
    this._activeSseConnections.add(connection);
    res.write(': stream opened\n\n');
    connection.pingInterval = setInterval(() => this.sendPing(connection), 15000);
    if (lastEventId && this._config.resumability.enabled) {
        this.handleResumption(connection, lastEventId).catch(err => { logger.error(`Error during stream resumption for ${streamId}: ${err.message}`); this.cleanupConnection(connection, `Resumption error: ${err.message}`); });
    }
    const cleanupHandler = (reason: string) => { if (connection.pingInterval) { clearInterval(connection.pingInterval); connection.pingInterval = undefined; } this.cleanupConnection(connection, reason); };
    res.on("close", () => cleanupHandler("Client closed connection"));
    res.on("error", (err) => { logger.error(`SSE stream ${streamId} error: ${err.message}`); cleanupHandler(`Connection error: ${err.message}`); this._onerror?.(err); });
    res.on("finish", () => cleanupHandler("Stream finished"));
    logger.info(`SSE stream ${streamId} active (Session: ${sessionId || 'N/A'}, Total: ${this._activeSseConnections.size})`);
    return connection;
  }

  private cleanupConnection(connection: ActiveSseConnection, reason: string): void {
    if (!this._activeSseConnections.has(connection)) return;
    const { streamId, sessionId, pingInterval } = connection;
    logger.info(`Cleaning up SSE stream ${streamId} (Session: ${sessionId || 'N/A'}). Reason: ${reason}.`);
    if (pingInterval) clearInterval(pingInterval);
    this._activeSseConnections.delete(connection);
    const requestIdsToRemove: (string | number)[] = [];
    this._requestStreamMap.forEach((conn, reqId) => { if (conn === connection) requestIdsToRemove.push(reqId); });
    requestIdsToRemove.forEach(reqId => this._requestStreamMap.delete(reqId));
    if(requestIdsToRemove.length > 0) logger.debug(`Removed ${requestIdsToRemove.length} request associations for closed stream ${streamId}`);
    if (connection.res && !connection.res.writableEnded) { try { connection.res.end(); } catch (e: any) { logger.warn(`Error ending response stream ${streamId}: ${e.message}`); } }
    logger.debug(`Total active SSE connections after cleanup: ${this._activeSseConnections.size}`);
  }


  private cleanupAllConnections(): void {
    logger.info(`Cleaning up all ${this._activeSseConnections.size} active SSE connections and ${this._pendingBatches.size} pending batches.`);
    Array.from(this._activeSseConnections).forEach(conn => this.cleanupConnection(conn, "Server shutting down"));
    this._requestStreamMap.clear();
    this._pendingBatches.forEach(batchState => { clearTimeout(batchState.timeoutId); if (batchState.res && !batchState.res.writableEnded) { try { batchState.res.end(); } catch {} } });
    this._pendingBatches.clear();
    this._activeSessions.clear();
  }


  async send(message: JsonRpcMessage): Promise<void> { 
    logger.debug(`Attempting to send message: ${JSON.stringify(message)}`);


    if (isResponse(message) && message.id !== null) {
        for (const [res, batchState] of this._pendingBatches.entries()) {
            if (!batchState.isCompleted && batchState.requestIds.has(message.id)) {
                 logger.debug(`Batch mode: Collected response for ID ${message.id}`);
                 batchState.responses.set(message.id, message); 
                 if (batchState.responses.size === batchState.requestIds.size) {
                     this.completeBatchResponse(batchState);
                 } else {
                     logger.debug(`Batch mode: Still waiting for ${batchState.requestIds.size - batchState.responses.size} responses.`);
                 }
                 return;
            }
        }
        logger.debug(`Response ID ${message.id} did not match pending batch, checking streams.`);
    }

    let targetConnection: ActiveSseConnection | undefined;

    if (isResponse(message) && message.id !== null) {
        targetConnection = this._requestStreamMap.get(message.id);
        if (targetConnection) {
            this._requestStreamMap.delete(message.id);
            logger.debug(`Stream mode: Found target stream ${targetConnection.streamId} for response ID ${message.id}`);
        } else {
            logger.warn(`Stream mode: No active stream found mapping to response ID ${message.id}. Message dropped.`);
            return;
        }
    }

    if (!targetConnection) {
        targetConnection = Array.from(this._activeSseConnections).find(c => c.res && !c.res.writableEnded);
        if (targetConnection) logger.debug(`Stream mode: No specific target, selected available stream ${targetConnection.streamId}`);
    }

    if (!targetConnection || !targetConnection.res || targetConnection.res.writableEnded) {
      logger.error(`Cannot send message via SSE: No suitable stream found. Message dropped: ${JSON.stringify(message)}`);
      return;
    }

    try {
        let eventId: string | undefined = undefined;
        if (this._config.resumability.enabled) {
            eventId = `${Date.now()}-${this._eventCounter++}`;
            targetConnection.lastEventIdSent = eventId;
            if (targetConnection.messageHistory) {
                const timestamp = Date.now();
                targetConnection.messageHistory.push({ eventId, message, timestamp });
                const cutoff = timestamp - this._config.resumability.historyDuration;
                targetConnection.messageHistory = targetConnection.messageHistory.filter(entry => entry.timestamp >= cutoff);
            }
             logger.debug(`Sending SSE event ID: ${eventId} on stream ${targetConnection.streamId}`);
             targetConnection.res.write(`id: ${eventId}\n`);
        }
      logger.debug(`Sending SSE data on stream ${targetConnection.streamId}: ${JSON.stringify(message)}`);
      targetConnection.res.write(`data: ${JSON.stringify(message)}\n\n`);

    } catch (error: any) {
      logger.error(`Error writing to SSE stream ${targetConnection.streamId}: ${error.message}. Cleaning up connection.`);
      this.cleanupConnection(targetConnection, `Write error: ${error.message}`);
    }
  }

  private sendPing(connection: ActiveSseConnection): void {
      if (!connection || !connection.res || connection.res.writableEnded) return;
      try {
          connection.res.write(': keep-alive\n\n');
          logger.debug(`Sent keep-alive ping to stream ${connection.streamId}`);
      } catch (error: any) {
          logger.error(`Error sending ping to stream ${connection.streamId}: ${error.message}`);
          if (this._activeSseConnections.has(connection)) { this.cleanupConnection(connection, `Ping error: ${error.message}`); }
      }
  }


  private async handleAuthentication(req: IncomingMessage, res: ServerResponse, context: string, session?: SessionData, requestId?: JsonRpcId): Promise<AuthResult | true> {
    const provider = this._config.auth?.provider;
    if (!provider) { logger.debug(`Auth skipped for ${context}: No provider.`); return true; }
    logger.debug(`Attempting auth for ${context} via ${provider.constructor.name}`);
    let authResult: boolean | AuthResult;
    try { authResult = await provider.authenticate(req); }
    catch (error: any) { logger.error(`Auth provider error for ${context}: ${error.message}`); throw this.httpError(500, "Authentication provider error", -32001, error, requestId); }
    if (!authResult) { const errDet = provider.getAuthError?.() || DEFAULT_AUTH_ERROR; logger.warn(`Auth failed for ${context}: ${errDet.message}`); throw this.httpError(errDet.status, errDet.message, -32002, undefined, requestId); }
    logger.info(`Auth successful for ${context}.`); return typeof authResult === 'object' ? authResult : true;
  }

  private validateSession(sessionIdHeader: string | undefined, req: IncomingMessage, isMandatory: boolean, requestId?: JsonRpcId): SessionData {
    if (!this._config.session.enabled) throw this.httpError(500, "Internal Server Error: Session validation called when sessions disabled", -32003, undefined, requestId);
    const headerName = this._config.session.headerName;
    if (!sessionIdHeader) { if (isMandatory) { logger.warn(`Mandatory session ID missing: ${headerName}`); throw this.httpError(400, `Bad Request: Missing required session header ${headerName}`, -32601, undefined, requestId); } else { logger.warn(`Session ID missing for non-init request: ${headerName}`); throw this.httpError(400, `Bad Request: Session header ${headerName} required`, -32601, undefined, requestId); } }
    const session = this._activeSessions.get(sessionIdHeader);
    if (!session) { logger.warn(`Invalid/expired session ID: ${sessionIdHeader}`); throw this.httpError(404, 'Not Found: Invalid or expired session ID', -32004, undefined, requestId); }
    logger.debug(`Session ${session.id} validated.`); return session;
  }

  private async handleResumption(connection: ActiveSseConnection, lastEventId: string): Promise<void> {
      logger.info(`Attempting resume stream ${connection.streamId} from event ${lastEventId}`);
      if (!connection.messageHistory || !this._config.resumability.enabled) { logger.warn(`Resume requested for ${connection.streamId}, but history unavailable/disabled. Starting fresh.`); return; }
      const history = connection.messageHistory;
      const lastReceivedIndex = history.findIndex(entry => entry.eventId === lastEventId);
      if (lastReceivedIndex === -1) { logger.warn(`Event ${lastEventId} not found in history for ${connection.streamId}. Starting fresh.`); return; }
      const messagesToReplay = history.slice(lastReceivedIndex + 1);
      if (messagesToReplay.length === 0) { logger.info(`Event ${lastEventId} was last known event for ${connection.streamId}. No replay needed.`); return; }
      logger.info(`Replaying ${messagesToReplay.length} messages for stream ${connection.streamId}`);
      for (const entry of messagesToReplay) {
           if (!connection.res || connection.res.writableEnded) { logger.warn(`Stream ${connection.streamId} closed during replay. Aborting.`); return; }
           try {
               logger.debug(`Replaying event ${entry.eventId}`);
               connection.res.write(`id: ${entry.eventId}\n`);
               connection.res.write(`data: ${JSON.stringify(entry.message)}\n\n`);
               connection.lastEventIdSent = entry.eventId;
           } catch(error: any) { logger.error(`Error replaying message ${entry.eventId} to ${connection.streamId}: ${error.message}. Aborting.`); this.cleanupConnection(connection, `Replay write error: ${error.message}`); return; }
      }
      logger.info(`Finished replaying messages for stream ${connection.streamId}`);
  }

  private handleIncomingMessage(message: JsonRpcMessage, sessionId?: string): void {
    let method = 'response/notification';
    let id: JsonRpcId = '';
    
    if (isRequest(message) || isNotification(message)) {
      method = message.method;
    }
    if (isRequest(message) || isResponse(message)) {
      id = message.id;
    }

    logger.debug(`Forwarding msg to handler (Session: ${sessionId || 'N/A'}): ${method} ${id}`);
    logger.debug(`Incoming message detail: ${JSON.stringify(message)}`);

    if (!this._onmessage) {
      logger.error("No message handler. Dropping message.");
      return;
    }
    
    try {
      this._onmessage(message as any);
    } catch (error: any) {
      logger.error(`Sync error in _onmessage handler: ${error.message}.`);
    }
  }


  private httpError(
      statusCode: number, message: string, code: number = -32000,
      data?: any, requestId?: JsonRpcId
  ): Error & { statusCode: number; code: number; data?: any; requestId?: JsonRpcId } {
      const error = new Error(message) as Error & { statusCode: number; code: number; data?: any; requestId?: JsonRpcId };
      error.statusCode = statusCode; error.code = code; error.data = data; error.requestId = requestId;
      return error;
  }

  async close(): Promise<void> {
    logger.info("Closing HttpStreamTransport...");
    this.cleanupAllConnections();
    return new Promise((resolve, reject) => {
      if (this._server) {
        const server = this._server; this._server = undefined;
        const timeout = setTimeout(() => { logger.warn("HTTP server close timed out."); reject(new Error("Server close timed out")); }, 5000);
        server.close((err) => { clearTimeout(timeout); if (err) { logger.error(`Error closing HTTP server: ${err.message}`); reject(err); } else { logger.info("HTTP server closed successfully."); resolve(); } });
      } else { logger.debug("HTTP server already closed."); resolve(); }
    });
  }
  isRunning(): boolean { return Boolean(this._server?.listening); }
}
