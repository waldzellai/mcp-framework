import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolLoader } from "./toolLoader.js";
import { BaseTool } from "../tools/BaseTool.js";

export interface MCPServerConfig {
  name: string;
  version: string;
}

export class MCPServer {
  private server: Server;
  private toolsMap: Map<string, BaseTool> = new Map();
  private toolLoader: ToolLoader;

  constructor(config: MCPServerConfig) {
    this.server = new Server(
      {
        name: config.name,
        version: config.version,
      },
      {
        capabilities: {
          tools: {
            enabled: true,
          },
        },
      }
    );

    this.toolLoader = new ToolLoader();
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.toolsMap.values()).map(
          (tool) => tool.toolDefinition
        ),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.toolsMap.get(request.params.name);
      if (!tool) {
        throw new Error(
          `Unknown tool: ${request.params.name}. Available tools: ${Array.from(
            this.toolsMap.keys()
          ).join(", ")}`
        );
      }
      return tool.toolCall(request);
    });
  }

  async start() {
    try {
      const tools = await this.toolLoader.loadTools();
      this.toolsMap = new Map(tools.map((tool: BaseTool) => [tool.name, tool]));

      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      process.stderr.write(`Server started with ${tools.length} tools\n`);
    } catch (error) {
      process.stderr.write(`Server initialization error: ${error}\n`);
      throw error;
    }
  }
}
