import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolLoader } from "./toolLoader.js";
import { PromptLoader } from "./promptLoader.js";
import { ToolProtocol } from "../tools/BaseTool.js";
import { PromptProtocol } from "../prompts/BasePrompt.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { logger } from "./Logger.js";

export interface MCPServerConfig {
  name?: string;
  version?: string;
  basePath?: string;
}

export type ServerCapabilities = {
  tools?: {
    enabled: true;
  };
  schemas?: {
    enabled: true;
  };
  prompts?: {
    enabled: true;
  };
};

export class MCPServer {
  private server: Server;
  private toolsMap: Map<string, ToolProtocol> = new Map();
  private promptsMap: Map<string, PromptProtocol> = new Map();
  private toolLoader: ToolLoader;
  private promptLoader: PromptLoader;
  private serverName: string;
  private serverVersion: string;
  private basePath: string;

  constructor(config: MCPServerConfig = {}) {
    this.basePath = this.resolveBasePath(config.basePath);
    this.serverName = config.name ?? this.getDefaultName();
    this.serverVersion = config.version ?? this.getDefaultVersion();

    logger.info(
      `Initializing MCP Server: ${this.serverName}@${this.serverVersion}`
    );

    this.toolLoader = new ToolLoader(this.basePath);
    this.promptLoader = new PromptLoader(this.basePath);

    this.server = new Server(
      {
        name: this.serverName,
        version: this.serverVersion,
      },
      {
        capabilities: {
          tools: { enabled: true },
          prompts: { enabled: false },
        },
      }
    );

    this.setupHandlers();
  }

  private resolveBasePath(configPath?: string): string {
    if (configPath) {
      return configPath;
    }
    if (process.argv[1]) {
      return process.argv[1];
    }
    return process.cwd();
  }

  private readPackageJson(): any {
    try {
      const packagePath = join(dirname(this.basePath), "package.json");
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
    const packageJson = this.readPackageJson();
    if (packageJson?.name) {
      logger.info(`Using name from package.json: ${packageJson.name}`);
      return packageJson.name;
    }
    return "unnamed-mcp-server";
  }

  private getDefaultVersion(): string {
    const packageJson = this.readPackageJson();
    if (packageJson?.version) {
      logger.info(`Using version from package.json: ${packageJson.version}`);
      return packageJson.version;
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

      const toolRequest = {
        params: request.params,
        method: "tools/call" as const,
      };

      return tool.toolCall(toolRequest);
    });

    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      return {
        prompts: Array.from(this.promptsMap.values()).map(
          (prompt) => prompt.promptDefinition
        ),
      };
    });

    this.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = this.promptsMap.get(request.params.name);
      if (!prompt) {
        throw new Error(
          `Unknown prompt: ${
            request.params.name
          }. Available prompts: ${Array.from(this.promptsMap.keys()).join(
            ", "
          )}`
        );
      }

      return {
        messages: await prompt.getMessages(request.params.arguments),
      };
    });
  }

  private async detectCapabilities(): Promise<ServerCapabilities> {
    const capabilities: ServerCapabilities = {};

    if (await this.toolLoader.hasTools()) {
      capabilities.tools = { enabled: true };
      logger.debug("Tools capability enabled");
    } else {
      logger.debug("No tools found, tools capability disabled");
    }

    if (await this.promptLoader.hasPrompts()) {
      capabilities.prompts = { enabled: true };
      logger.debug("Prompts capability enabled");
    } else {
      logger.debug("No prompts found, prompts capability disabled");
    }

    return capabilities;
  }

  async start() {
    try {
      const tools = await this.toolLoader.loadTools();
      this.toolsMap = new Map(
        tools.map((tool: ToolProtocol) => [tool.name, tool])
      );

      const prompts = await this.promptLoader.loadPrompts();
      this.promptsMap = new Map(
        prompts.map((prompt: PromptProtocol) => [prompt.name, prompt])
      );

      this.detectCapabilities();

      const transport = new StdioServerTransport();
      await this.server.connect(transport);

      if (tools.length > 0 || prompts.length > 0) {
        logger.info(
          `Started ${this.serverName}@${this.serverVersion} with ${tools.length} tools and ${prompts.length} prompts`
        );
        if (tools.length > 0) {
          logger.info(
            `Available tools: ${Array.from(this.toolsMap.keys()).join(", ")}`
          );
        }
        if (prompts.length > 0) {
          logger.info(
            `Available prompts: ${Array.from(this.promptsMap.keys()).join(
              ", "
            )}`
          );
        }
      } else {
        logger.info(
          `Started ${this.serverName}@${this.serverVersion} with no tools or prompts`
        );
      }
    } catch (error) {
      logger.error(`Server initialization error: ${error}`);
      throw error;
    }
  }
}
