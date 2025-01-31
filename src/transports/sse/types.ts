/**
 * Configuration options for SSE transport
 */
export interface SSETransportConfig {
  /**
   * Port to listen on
   * @default 8080
   */
  port?: number;

  /**
   * Endpoint for SSE events stream
   * @default "/sse"
   */
  endpoint?: string;

  /**
   * Endpoint for receiving messages via POST
   * @default "/messages"
   */
  messageEndpoint?: string;

  /**
   * Maximum allowed message size in bytes
   * @default "4mb"
   */
  maxMessageSize?: string;

  /**
   * Custom headers to add to SSE responses
   */
  headers?: Record<string, string>;
}

/**
 * Internal configuration type with required fields except headers
 */
export type SSETransportConfigInternal = Required<Omit<SSETransportConfig, 'headers'>> & {
  headers?: Record<string, string>;
};

/**
 * Default configuration values
 */
export const DEFAULT_SSE_CONFIG: SSETransportConfigInternal = {
  port: 8080,
  endpoint: "/sse",
  messageEndpoint: "/messages",
  maxMessageSize: "4mb"
};
