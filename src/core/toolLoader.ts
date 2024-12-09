import { BaseTool } from "../tools/BaseTool.js";
import { dirname, join } from "path";
import { promises as fs } from "fs";
import { statSync } from "fs";
import { fileURLToPath } from "url";
import { cwd } from "process";
import { logger } from "./Logger.js";

export interface ToolLoaderOptions {
  toolsDir?: string;
  exclude?: string[];
}

export class ToolLoader {
  private toolsDir: string;
  private exclude: string[];

  constructor(options: ToolLoaderOptions = {}) {
    this.exclude = options.exclude || ["BaseTool.js", "*.test.js", "*.spec.js"];
    this.toolsDir = this.resolveToolsDir(options.toolsDir);
    logger.debug(`Initialized ToolLoader with directory: ${this.toolsDir}`);
  }

  private resolveToolsDir(toolsDir?: string): string {
    if (toolsDir) {
      logger.debug(`Using provided tools directory: ${toolsDir}`);
      return toolsDir;
    }

    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFilePath);
    const possiblePaths = [
      join(currentDir, "..", "tools"),
      join(currentDir, "..", "..", "tools"),
      join(cwd(), "dist", "tools"),
      join(cwd(), "build", "tools"),
      join(cwd(), "tools"),
    ];

    logger.debug(
      `Searching for tools in possible paths:\n${possiblePaths.join("\n")}`
    );

    for (const path of possiblePaths) {
      try {
        if (statSync(path).isDirectory()) {
          logger.debug(`Found existing tools directory: ${path}`);
          return path;
        }
      } catch (e) {
        logger.debug(`Path ${path} not accessible`);
      }
    }

    const fallbackPath = join(cwd(), "dist", "tools");
    logger.debug(
      `No valid tools directory found, falling back to: ${fallbackPath}`
    );
    return fallbackPath;
  }

  private isToolFile(file: string): boolean {
    if (!file.endsWith(".js")) return false;
    const isExcluded = this.exclude.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(pattern.replace("*", ".*"));
        return regex.test(file);
      }
      return file === pattern;
    });

    logger.debug(
      `Checking file ${file}: ${isExcluded ? "excluded" : "included"}`
    );
    return !isExcluded;
  }

  private validateTool(tool: any): tool is BaseTool {
    const isValid = Boolean(
      tool &&
        typeof tool.name === "string" &&
        tool.toolDefinition &&
        typeof tool.toolCall === "function"
    );

    if (isValid) {
      logger.debug(`Validated tool: ${tool.name}`);
    } else {
      logger.warn(`Invalid tool found: missing required properties`);
    }

    return isValid;
  }

  async loadTools(): Promise<BaseTool[]> {
    try {
      logger.debug(`Attempting to load tools from: ${this.toolsDir}`);

      let stats;
      try {
        stats = await fs.stat(this.toolsDir);
      } catch (error) {
        logger.error(`Error accessing tools directory: ${error}`);
        return [];
      }

      if (!stats.isDirectory()) {
        logger.error(`Path is not a directory: ${this.toolsDir}`);
        return [];
      }

      const files = await fs.readdir(this.toolsDir);
      logger.debug(`Found files in directory: ${files.join(", ")}`);

      const tools: BaseTool[] = [];

      for (const file of files) {
        if (!this.isToolFile(file)) {
          continue;
        }

        try {
          const fullPath = join(this.toolsDir, file);
          logger.debug(`Attempting to load tool from: ${fullPath}`);

          const importPath = `file://${fullPath}`;
          const { default: ToolClass } = await import(importPath);

          if (!ToolClass) {
            logger.warn(`No default export found in ${file}`);
            continue;
          }

          const tool = new ToolClass();
          if (this.validateTool(tool)) {
            tools.push(tool);
          }
        } catch (error) {
          logger.error(`Error loading tool ${file}: ${error}`);
        }
      }

      logger.debug(
        `Successfully loaded ${tools.length} tools: ${tools
          .map((t) => t.name)
          .join(", ")}`
      );
      return tools;
    } catch (error) {
      logger.error(`Failed to load tools: ${error}`);
      return [];
    }
  }
}
