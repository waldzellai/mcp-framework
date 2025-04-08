import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js";
import readline from "readline/promises";

/**
 * Supported MCPClient configuration types.
 */
type MCPClientConfig =
  | {
      transport: "stdio";
      serverScriptPath: string;
    }
  | {
      transport: "sse";
      url: string;
      headers?: Record<string, string>;
    }
  | {
      transport: "websocket";
      url: string;
      headers?: Record<string, string>;
    }
  | {
      transport: "http-stream";
      url: string;
      headers?: Record<string, string>;
    };

/**
 * MCPClient supports connecting to an MCP server over multiple transports:
 * - stdio (spawns a subprocess)
 * - SSE (connects to a remote HTTP SSE endpoint)
 * - WebSocket (connects to a remote WebSocket endpoint)
 */
class MCPClient {
  private mcp: Client;
  private transport: any = null;
  private tools: any[] = [];

  constructor() {
    this.mcp = new Client({ name: "mcp-client-cli", version: "1.0.0" });
  }

  /**
   * Connect to an MCP server using the specified transport configuration.
   * This replaces the old connectToServer() method.
   */
  async connect(config: MCPClientConfig) {
    try {
      if (config.transport === "stdio") {
        // === STDIO TRANSPORT ===
        // Spawn a subprocess running the server script (JS or Python)
        const isJs = config.serverScriptPath.endsWith(".js");
        const isPy = config.serverScriptPath.endsWith(".py");
        if (!isJs && !isPy) {
          throw new Error("Server script must be a .js or .py file");
        }
        const command = isPy
          ? process.platform === "win32"
            ? "python"
            : "python3"
          : process.execPath;

        this.transport = new StdioClientTransport({
          command,
          args: [config.serverScriptPath],
        });
      } else if (config.transport === "sse") {
        // === SSE TRANSPORT ===
        // Connect to a remote MCP server's SSE endpoint
        this.transport = new SSEClientTransport(
          new URL(config.url)
        );
      } else if (config.transport === "websocket") {
        // === WEBSOCKET TRANSPORT ===
        // Connect to a remote MCP server's WebSocket endpoint
        this.transport = new WebSocketClientTransport(
          new URL(config.url)
        );
      } else if (config.transport === "http-stream") {
        // === HTTP STREAM TRANSPORT ===
        // Connect to a remote MCP server's HTTP streaming POST endpoint
        const httpStreamTransport = new (globalThis as any).HttpStreamClientTransport(config.url);
        this.transport = httpStreamTransport;
      } else {
        throw new Error(`Unsupported transport type: ${(config as any).transport}`);
      }

      // Connect the SDK client with the selected transport
      this.mcp.connect(this.transport);

      // Fetch available tools from the server
      const toolsResult = await this.mcp.listTools();
      this.tools = toolsResult.tools.map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        };
      });
      // Successfully connected to server
    } catch (e) {
      // Log error but don't expose internal details
      throw e;
    }
  }

  async callTool(toolName: string, toolArgs: any) {
    return await this.mcp.callTool({
      name: toolName,
      arguments: toolArgs,
    });
  }

  async chatLoop() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      while (true) {
        const message = await rl.question("\nCommand: ");
        if (message.toLowerCase() === "quit") {
          break;
        }

        // This is where you would implement your own command handling logic
        // Process command here
      }
    } finally {
      rl.close();
    }
  }

  async cleanup() {
    await this.mcp.close();
  }

  getTools() {
    return this.tools;
  }
}

async function main() {
  // ================================
  // MCP Client CLI Argument Parsing
  // ================================

  // Extract CLI args (skip 'node' and script path)
  const args = process.argv.slice(2);

  // Simple manual argument parsing
  const argMap: Record<string, string | undefined> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].substring(2);
      const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
      argMap[key] = value;
      if (value) i++; // Skip next since it's a value
    }
  }

  const transport = argMap["transport"];
  const script = argMap["script"];
  const url = argMap["url"];

  // Print usage instructions
  function printUsageAndExit() {
    // Print usage instructions for CLI mode
    process.exit(1);
  }

  // Validate required args
  if (!transport || !["stdio", "sse", "websocket"].includes(transport)) {
    printUsageAndExit();
  }

  if (transport === "stdio" && !script) {
    printUsageAndExit();
  }

  if ((transport === "sse" || transport === "websocket") && !url) {
    printUsageAndExit();
  }

  // Build MCPClientConfig based on args
  let config: MCPClientConfig;
  if (transport === "stdio") {
    config = {
      transport: "stdio",
      serverScriptPath: script!,
    };
  } else if (transport === "sse") {
    config = {
      transport: "sse",
      url: url!,
    };
  } else {
    config = {
      transport: "websocket",
      url: url!,
    };
  }

  const mcpClient = new MCPClient();
  try {
    await mcpClient.connect(config);
    await mcpClient.chatLoop();
  } finally {
    await mcpClient.cleanup();
    process.exit(0);
  }
}

export { MCPClient };

if (require.main === module) {
  main();

}
