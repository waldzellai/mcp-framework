import { BaseTool } from "../tools/BaseTool.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { promises as fs } from "fs";
import { cwd } from "process";

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
    // Use current working directory + dist/tools as default
    return join(cwd(), "dist", "tools");
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
      console.log(`Loading tools from directory: ${this.toolsDir}`);
      const files = await fs.readdir(this.toolsDir);
      console.log(`Found files: ${files.join(", ")}`);

      const toolPromises = files
        .filter((file) => this.isToolFile(file))
        .map(async (file) => {
          try {
            const fullPath = join(this.toolsDir, file);
            console.log(`Loading tool from: ${fullPath}`);
            const { default: ToolClass } = await import(`file://${fullPath}`);

            if (!ToolClass) {
              console.log(`No default export found in ${file}`);
              return null;
            }

            const tool = new ToolClass();
            if (this.validateTool(tool)) {
              console.log(`Successfully loaded tool: ${tool.name}`);
              return tool;
            }
            console.log(`Invalid tool found in ${file}`);
            return null;
          } catch (error) {
            console.error(`Error loading tool ${file}:`, error);
            return null;
          }
        });

      const tools = (await Promise.all(toolPromises)).filter(
        Boolean
      ) as BaseTool[];
      console.log(
        `Loaded ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`
      );
      return tools;
    } catch (error) {
      console.error(`Failed to load tools from ${this.toolsDir}:`, error);
      return [];
    }
  }
}
