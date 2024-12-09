import { ResourceProtocol } from "../resources/BaseResource.js";
import { join, dirname } from "path";
import { promises as fs } from "fs";
import { logger } from "../core/Logger.js";

export class ResourceLoader {
  private readonly RESOURCES_DIR: string;
  private readonly EXCLUDED_FILES = [
    "BaseResource.js",
    "*.test.js",
    "*.spec.js",
  ];

  constructor(basePath?: string) {
    const mainModulePath = basePath || process.argv[1];
    this.RESOURCES_DIR = join(dirname(mainModulePath), "resources");
    logger.debug(
      `Initialized ResourceLoader with directory: ${this.RESOURCES_DIR}`
    );
  }

  async hasResources(): Promise<boolean> {
    try {
      const stats = await fs.stat(this.RESOURCES_DIR);
      if (!stats.isDirectory()) {
        logger.debug("Resources path exists but is not a directory");
        return false;
      }

      const files = await fs.readdir(this.RESOURCES_DIR);
      const hasValidFiles = files.some((file) => this.isResourceFile(file));
      logger.debug(`Resources directory has valid files: ${hasValidFiles}`);
      return hasValidFiles;
    } catch (error) {
      logger.debug("No resources directory found");
      return false;
    }
  }

  private isResourceFile(file: string): boolean {
    if (!file.endsWith(".js")) return false;
    const isExcluded = this.EXCLUDED_FILES.some((pattern) => {
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

  private validateResource(resource: any): resource is ResourceProtocol {
    const isValid = Boolean(
      resource &&
        typeof resource.uri === "string" &&
        typeof resource.name === "string" &&
        resource.resourceDefinition &&
        typeof resource.read === "function"
    );

    if (isValid) {
      logger.debug(`Validated resource: ${resource.name}`);
    } else {
      logger.warn(`Invalid resource found: missing required properties`);
    }

    return isValid;
  }

  async loadResources(): Promise<ResourceProtocol[]> {
    try {
      logger.debug(`Attempting to load resources from: ${this.RESOURCES_DIR}`);

      let stats;
      try {
        stats = await fs.stat(this.RESOURCES_DIR);
      } catch (error) {
        logger.debug("No resources directory found");
        return [];
      }

      if (!stats.isDirectory()) {
        logger.error(`Path is not a directory: ${this.RESOURCES_DIR}`);
        return [];
      }

      const files = await fs.readdir(this.RESOURCES_DIR);
      logger.debug(`Found files in directory: ${files.join(", ")}`);

      const resources: ResourceProtocol[] = [];

      for (const file of files) {
        if (!this.isResourceFile(file)) {
          continue;
        }

        try {
          const fullPath = join(this.RESOURCES_DIR, file);
          logger.debug(`Attempting to load resource from: ${fullPath}`);

          const importPath = `file://${fullPath}`;
          const { default: ResourceClass } = await import(importPath);

          if (!ResourceClass) {
            logger.warn(`No default export found in ${file}`);
            continue;
          }

          const resource = new ResourceClass();
          if (this.validateResource(resource)) {
            resources.push(resource);
          }
        } catch (error) {
          logger.error(`Error loading resource ${file}: ${error}`);
        }
      }

      logger.debug(
        `Successfully loaded ${resources.length} resources: ${resources
          .map((r) => r.name)
          .join(", ")}`
      );
      return resources;
    } catch (error) {
      logger.error(`Failed to load resources: ${error}`);
      return [];
    }
  }
}
