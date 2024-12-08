# mcp-framework

A framework for building Model Context Protocol (MCP) servers with automatic tool loading and management in Typescript.

Get started fast with mcp-framework ⚡⚡⚡

## Features

- 🛠️ Automatic tool discovery and loading
- 🏗️ Base tool implementation with helper methods
- ⚙️ Configurable tool directory and exclusions
- 🔒 Type-safe tool validation
- 🚀 Simple server setup and configuration
- 🐛 Built-in error handling and logging

## Installation

```bash
npm install mcp-framework @modelcontextprotocol/sdk
```

## Quick Start

1. Create your MCP server:

```typescript
import { MCPServer } from "mcp-framework";

const server = new MCPServer({
  name: "my-mcp-server",
  version: "1.0.0",
  toolsDir: "./dist/tools", // Optional: defaults to dist/tools
});

server.start().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
```

2. Create a tool by extending BaseToolImplementation:

```typescript
import { BaseToolImplementation } from "mcp-framework";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

class ExampleTool extends BaseToolImplementation {
  name = "example_tool";
  toolDefinition: Tool = {
    name: this.name,
    description: "An example tool",
    inputSchema: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "Input parameter",
        },
      },
    },
  };

  async toolCall(request: any) {
    try {
      const input = request.params.arguments?.input;
      if (!input) {
        throw new Error("Missing input parameter");
      }

      const result = `Processed: ${input}`;
      return this.createSuccessResponse(result);
    } catch (error) {
      return this.createErrorResponse(error);
    }
  }
}

export default ExampleTool;
```

## Configuration

### MCPServer Options

- `name`: Server name
- `version`: Server version
- `toolsDir`: Directory containing tool files (optional)
- `excludeTools`: Array of patterns for files to exclude (optional)

### Project Structure

```
your-project/
├── src/
│   ├── tools/
│   │   ├── ExampleTool.ts
│   │   └── OtherTool.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

## License

MIT
