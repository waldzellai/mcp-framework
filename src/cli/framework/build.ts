import { execa } from "execa";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export async function buildFramework() {
  const projectDir = process.cwd();
  
  try {
    console.log(`Building project in: ${projectDir}`);
    
    await execa("tsc", [], {
      stdio: "inherit",
      reject: true,
      cwd: projectDir
    });

    const distPath = join(projectDir, "dist");
    const projectIndexPath = join(distPath, "index.js");
    const shebang = "#!/usr/bin/env node\n";
    
    const content = await readFile(projectIndexPath, "utf8");
    if (!content.startsWith(shebang)) {
      await writeFile(projectIndexPath, shebang + content);
    }

    console.log("Build complete!");
  } catch (error) {
    console.error("Build failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === new URL(import.meta.url).href) {
  buildFramework().catch(console.error);
}
