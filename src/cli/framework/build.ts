import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { platform } from "os";

interface NodeError extends Error {
  code?: string;
}

export function buildFramework() {
  const isCreatingProject = process.argv.includes('create');
  if (isCreatingProject) {
    return; 
  }

  const projectDir = process.cwd();
  const tsconfigPath = join(projectDir, "tsconfig.json");

  if (!existsSync(tsconfigPath)) {
    console.error("Error: tsconfig.json not found!");
    process.exit(1);
  }
  console.log("Found tsconfig.json");

  const isWindows = platform() === "win32";
  const nodeModulesPath = join(projectDir, "node_modules");
  const tscBin = join(nodeModulesPath, ".bin", "tsc");
  const tscPath = isWindows ? `${tscBin}.cmd` : tscBin;

  let spawnResult;
  
  if (isWindows) {
    spawnResult = spawnSync(tscPath, [], {
      stdio: "inherit",
      env: process.env,
      shell: true
    });
  } else {
    spawnResult = spawnSync(tscPath, [], {
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1"
      }
    });
  }

  if (spawnResult.error) {
    const nodeError = spawnResult.error as NodeError;
    if (nodeError.code === 'ENOENT') {
      console.error("TypeScript compiler not found. Please ensure TypeScript is installed.");
      process.exit(1);
    }
    console.error("TypeScript compilation error:", nodeError);
    process.exit(1);
  }

  if (spawnResult.status !== 0) {
    console.error("TypeScript compilation failed");
    process.exit(spawnResult.status ?? 1);
  }

  try {
    const distPath = join(projectDir, "dist");

    if (!existsSync(distPath)) {
      console.error("Error: dist directory not found after compilation!");
      process.exit(1);
    }

    const cliIndexPath = join(distPath, "cli", "index.js");
    const indexPath = join(distPath, "index.js");
    
    const filesToAddShebang = [cliIndexPath, indexPath];

    for (const filePath of filesToAddShebang) {
      if (existsSync(filePath)) {
        console.log("Adding shebang to:", filePath);
        const content = readFileSync(filePath, "utf8");
        const shebang = "#!/usr/bin/env node\n";

        if (!content.startsWith(shebang)) {
          writeFileSync(filePath, shebang + content);
        }
      }
    }

    if (!existsSync(indexPath)) {
      console.error("Warning: index.js not found in dist directory");
    }
  } catch (error) {
    console.error("Error in shebang process:", error);
    process.exit(1);
  }

  console.log("Build complete!");
}

if (import.meta.url === new URL(import.meta.url).href) {
  buildFramework();
}
