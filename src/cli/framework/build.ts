#!/usr/bin/env node
import { execa } from "execa";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

process.stderr.write("MCP Build Script Starting...\n");

export async function buildFramework() {
    process.stderr.write("Finding project root...\n");
    
    const startDir = process.cwd();
    process.stderr.write(`Starting search from: ${startDir}\n`);
    
    let projectRoot: string | null = null;
    try {
        const pkgPath = join(startDir, 'package.json');
        const tsConfigPath = join(startDir, 'tsconfig.json');
        
        process.stderr.write(`Checking for package.json at: ${pkgPath}\n`);
        const [pkgContent, _tsConfigContent] = await Promise.all([
            readFile(pkgPath, 'utf8'),
            readFile(tsConfigPath, 'utf8')
        ]);
        
        const pkg = JSON.parse(pkgContent);
        if (pkg.dependencies?.["mcp-framework"]) {
            projectRoot = startDir;
            process.stderr.write(`Found MCP project at current directory: ${projectRoot}\n`);
        }
    } catch (error) {
        process.stderr.write(`Error checking current directory: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    if (!projectRoot) {
        process.stderr.write("Error: Current directory is not an MCP project\n");
        throw new Error('Current directory must be an MCP project with mcp-framework as a dependency');
    }

    try {
        process.stderr.write(`Running tsc in ${projectRoot}\n`);
        
        const tscCommand = process.platform === 'win32' ? ['npx.cmd', 'tsc'] : ['npx', 'tsc'];
            
        await execa(tscCommand[0], [tscCommand[1]], {
            cwd: projectRoot,
            stdio: "inherit",
            env: {
                ...process.env,
                ELECTRON_RUN_AS_NODE: "1",
                FORCE_COLOR: "1"
            }
        });

        const distPath = join(projectRoot, "dist");
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
        process.stderr.write(`Build error: ${error instanceof Error ? error.message : String(error)}\n`);
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
