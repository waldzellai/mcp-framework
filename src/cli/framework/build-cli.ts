#!/usr/bin/env node
import { buildFramework } from './build.js';

if (process.argv[1].endsWith('mcp-build')) {
    buildFramework().catch(error => {
        process.stderr.write(`Fatal error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
} 
