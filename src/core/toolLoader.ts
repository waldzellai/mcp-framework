import { BaseTool } from "../tools/BaseTool.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { promises as fs } from "fs";

export interface ToolLoaderOptions {
  toolsDir?: string;
  exclude?: string[];
}

export class ToolLoader {
  private toolsDir: string;
  private exclude: string[];

  constructor(options: ToolLoaderOptions = {}) {
    this.exclude = options.exclude || ["BaseTool.js", "*.test.js", "*.spec.js"];
    this.toolsDir = options.toolsDir || this.findDefaultToolsDir();
  }

  private findDefaultToolsDir(): string {
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFilePath);
    return join(currentDir, "..", "..", "dist", "tools");
  }

  private isToolFile(file: string): boolean {
    if (!file.endsWith(".js")) return false;
    return !this.exclude.some((pattern) => {
      if (pattern.includes("*")) {
        const regex = new RegExp(pattern.replace("*", ".*"));
        return regex.test(file);
      }
      return file === pattern;
    });
  }

  private validateTool(tool: any): tool is BaseTool {
    return Boolean(
      tool &&
        typeof tool.name === "string" &&
        tool.toolDefinition &&
        typeof tool.toolCall === "function"
    );
  }

  async loadTools(): Promise<BaseTool[]> {
    try {
      const files = await fs.readdir(this.toolsDir);

      const toolPromises = files
        .filter((file) => this.isToolFile(file))
        .map(async (file) => {
          try {
            const modulePath = `file://${join(this.toolsDir, file)}`;
            const { default: ToolClass } = await import(modulePath);

            if (!ToolClass) return null;

            const tool = new ToolClass();
            return this.validateTool(tool) ? tool : null;
          } catch {
            return null;
          }
        });

      const tools = (await Promise.all(toolPromises)).filter(
        Boolean
      ) as BaseTool[];
      return tools;
    } catch (error) {
      console.error(`Failed to load tools from ${this.toolsDir}`);
      return [];
    }
  }
}
