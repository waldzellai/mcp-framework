import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolLoader } from "./toolLoader.js";
import { BaseTool } from "../tools/BaseTool.js";
import { join, dirname } from "path";
import { logger } from "./Logger.js";

export interface MCPServerConfig {
  name?: string;
  version?: string;
}

export class MCPServer {
  private server: Server;
  private toolsMap: Map<string, BaseTool> = new Map();
  private toolLoader: ToolLoader;

  constructor(config: MCPServerConfig = {}) {
    const serverConfig = {
      name: config.name ?? this.getDefaultName(),
      version: config.version ?? this.getDefaultVersion(),
    };

    this.server = new Server(serverConfig, {
      capabilities: {
        tools: {
          enabled: true,
        },
      },
    });

    this.toolLoader = new ToolLoader();
    this.setupHandlers();
  }

  private getDefaultName(): string {
    try {
      const mainModulePath = process.argv[1];
      const packagePath = join(dirname(mainModulePath), "..", "package.json");
      const packageContent = require(packagePath);
      logger.debug(`Found package.json with name: ${packageContent.name}`);
      return packageContent.name;
    } catch (error) {
      logger.warn(`Could not read package.json for name: ${error}`);
      return "unnamed-mcp-server";
    }
  }

  private getDefaultVersion(): string {
    try {
      const mainModulePath = process.argv[1];
      const packagePath = join(dirname(mainModulePath), "..", "package.json");
      const packageContent = require(packagePath);
      logger.debug(
        `Found package.json with version: ${packageContent.version}`
      );
      return packageContent.version;
    } catch (error) {
      logger.warn(`Could not read package.json for version: ${error}`);
      return "0.0.0";
    }
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
