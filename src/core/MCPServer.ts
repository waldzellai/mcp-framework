import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolLoader } from "./toolLoader.js";
import { BaseTool } from "../tools/BaseTool.js";
import { readFileSync } from "fs";
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
  private serverName: string;
  private serverVersion: string;

  constructor(config: MCPServerConfig = {}) {
    this.serverName = config.name ?? this.getDefaultName();
    this.serverVersion = config.version ?? this.getDefaultVersion();

    logger.info(
      `Initializing MCP Server: ${this.serverName}@${this.serverVersion}`
    );

    this.server = new Server(
      {
        name: this.serverName,
        version: this.serverVersion,
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

  private readPackageJson(): any {
    try {
      const mainModulePath = process.argv[1];
      const packagePath = join(dirname(mainModulePath), "..", "package.json");
      const packageContent = readFileSync(packagePath, "utf-8");
      const packageJson = JSON.parse(packageContent);
      logger.debug(`Successfully read package.json from: ${packagePath}`);
      return packageJson;
    } catch (error) {
      logger.warn(`Could not read package.json: ${error}`);
      return null;
    }
  }

  private getDefaultName(): string {
    try {
      const packageJson = this.readPackageJson();
      if (packageJson?.name) {
        logger.info(`Using name from package.json: ${packageJson.name}`);
        return packageJson.name;
      }
    } catch (error) {
      logger.warn(`Error getting name from package.json: ${error}`);
    }
    return "unnamed-mcp-server";
  }

  private getDefaultVersion(): string {
    try {
      const packageJson = this.readPackageJson();
      if (packageJson?.version) {
        logger.info(`Using version from package.json: ${packageJson.version}`);
        return packageJson.version;
      }
    } catch (error) {
      logger.warn(`Error getting version from package.json: ${error}`);
    }
    return "0.0.0";
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

      logger.info(
        `Started ${this.serverName}@${this.serverVersion} with ${tools.length} tools`
      );
      logger.info(
        `Available tools: ${Array.from(this.toolsMap.keys()).join(", ")}`
      );
    } catch (error) {
      logger.error(`Server initialization error: ${error}`);
      throw error;
    }
  }
}
