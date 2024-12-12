#!/usr/bin/env node
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { platform } from "os";

export function buildFramework() {
  runTsc();
  addShebang();
  console.log("MCP Build complete");
}

function runTsc() {
  const isWindows = platform() === "win32";
  const tscPath = join(
    process.cwd(),
    "node_modules",
    ".bin",
    isWindows ? "tsc.cmd" : "tsc"
  );

  const tsc = spawnSync(tscPath, [], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PATH: process.env.PATH,
    },
  });

  if (tsc.status !== 0) {
    console.error("TypeScript compilation failed");
    process.exit(tsc.status ?? 1);
  }
}

function addShebang() {
  const indexPath = join(process.cwd(), "dist", "index.js");
  try {
    const content = readFileSync(indexPath, "utf8");
    const shebang = "#!/usr/bin/env node\n";

    if (!content.startsWith(shebang)) {
      writeFileSync(indexPath, shebang + content);
      console.log("Added shebang to dist/index.js");
    }
  } catch (error) {
    console.error("Error adding shebang:", error);
    process.exit(1);
  }
}
