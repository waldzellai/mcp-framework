import { execa } from "execa";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

export async function buildFramework() {
  const projectDir = process.cwd();

  try {
    await execa("npx", ["tsc"], {
      stdio: "inherit",
      reject: true,
    });

    const indexPath = join(projectDir, "dist", "index.js");
    const shebang = "#!/usr/bin/env node\n";
    
    const content = await readFile(indexPath, "utf8");
    if (!content.startsWith(shebang)) {
      await writeFile(indexPath, shebang + content);
    }
  } catch (error) {
    console.error("Build failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === new URL(import.meta.url).href) {
  buildFramework().catch(console.error);
}
