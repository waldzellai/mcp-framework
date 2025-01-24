#!/usr/bin/env node
import { execa } from "execa";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

process.stderr.write("MCP Build Script Starting...\n");

export async function buildFramework() {
    process.stderr.write("Finding project root...\n");
    
    const startDir = process.cwd();
    process.stderr.write(`Starting search from: ${startDir}\n`);
    
    if (process.argv.includes('create')) {
        process.stderr.write(`Skipping build for create command\n`);
        return;
    }
    
    try {
        const pkgPath = join(startDir, 'package.json');
        const pkgContent = await readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgContent);
        
        if (!pkg.dependencies?.["mcp-framework"]) {
            throw new Error("This directory is not an MCP project (mcp-framework not found in dependencies)");
        }
        
        process.stderr.write(`Running tsc in ${startDir}\n`);
        
        const tscCommand = process.platform === 'win32' ? ['npx.cmd', 'tsc'] : ['npx', 'tsc'];
            
        await execa(tscCommand[0], [tscCommand[1]], {
            cwd: startDir,
            stdio: "inherit",
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1",
                FORCE_COLOR: "1"
            }
        });

        const distPath = join(startDir, "dist");
        const projectIndexPath = join(distPath, "index.js");
        const shebang = "#!/usr/bin/env node\n";
        
        process.stderr.write("Adding shebang to index.js...\n");
        try {
            const content = await readFile(projectIndexPath, "utf8");
            if (!content.startsWith(shebang)) {
                await writeFile(projectIndexPath, shebang + content);
            }
        } catch (error) {
            process.stderr.write(`Error processing index.js: ${error instanceof Error ? error.message : String(error)}\n`);
            throw error;
        }

        process.stderr.write("Build completed successfully!\n");
    } catch (error) {
        process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
}

if (import.meta.url.startsWith('file:')) {
    process.stderr.write("Script running as main module\n");
    buildFramework().catch(error => {
        process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
}

export default buildFramework;
