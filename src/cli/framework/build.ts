import { execa } from "execa";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { findUp } from "find-up";

export async function buildFramework() {
    const projectRoot = await findUp(async directory => {
        const pkgPath = join(directory, 'package.json');
        const tsConfigPath = join(directory, 'tsconfig.json');
        
        try {
            const [pkgContent, tsConfigContent] = await Promise.all([
                readFile(pkgPath, 'utf8').catch(() => null),
                readFile(tsConfigPath, 'utf8').catch(() => null)
            ]);
            
            if (pkgContent && tsConfigContent) {
                return directory;
            }
        } catch {
            return undefined;
        }
    });

    if (!projectRoot) {
        throw new Error('Could not find target project root directory');
    }

    try {
        await execa("tsc", [], {
            stdio: "inherit",
            reject: true,
            cwd: projectRoot
        });

        const distPath = join(projectRoot, "dist");
        const projectIndexPath = join(distPath, "index.js");
        const shebang = "#!/usr/bin/env node\n";
        
        const content = await readFile(projectIndexPath, "utf8");
        if (!content.startsWith(shebang)) {
            await writeFile(projectIndexPath, shebang + content);
        }
    } catch (error) {
        console.error("Build failed:", error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

if (import.meta.url === new URL(import.meta.url).href) {
    buildFramework().catch(console.error);
}
