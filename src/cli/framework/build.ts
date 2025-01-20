import { execa } from "execa";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";

export async function buildFramework() {
  if (process.argv.includes('create')) return;

  const projectDir = process.cwd();
  const tsconfigPath = join(projectDir, "tsconfig.json");

  try {
    await access(tsconfigPath);

    await execa("npx", ["tsc"], {
      stdio: "inherit",
      reject: true,
    });

    const distPath = join(projectDir, "dist");
    const shebang = "#!/usr/bin/env node\n";
    
    const files = [
      join(distPath, "index.js"),
      join(distPath, "cli", "index.js")
    ];

    await Promise.all(files.map(async (file) => {
      try {
        const content = await readFile(file, "utf8");
        if (!content.startsWith(shebang)) {
          await writeFile(file, shebang + content);
        }
      } catch (error) {
        if (file.includes("cli")) return;
        throw error;
      }
    }));
  } catch (error) {
    console.error("Build failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (import.meta.url === new URL(import.meta.url).href) {
  buildFramework().catch(console.error);
}
