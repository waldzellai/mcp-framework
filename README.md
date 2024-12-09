# mcp-framework

A framework for building Model Context Protocol (MCP) servers elegantly in TypeScript.

Get started fast with mcp-framework ⚡⚡⚡

## Features

- 🛠️ Automatic directory-based discovery and loading for tools, prompts, and resources
- 🏗️ Powerful abstractions
- 🚀 Simple server setup and configuration

## Installation

```bash
npm install mcp-framework
```

## Quick Start

### 1. Create your MCP server:

```typescript
import { MCPServer } from "mcp-framework";

const server = new MCPServer();

server.start().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});
```

### 2. Create a Tool:

```typescript
import { MCPTool } from "mcp-framework";
import { z } from "zod";

interface ExampleInput {
  message: string;
}

class ExampleTool extends MCPTool<ExampleInput> {
  name = "example_tool";
  description = "An example tool that processes messages";

  schema = {
    message: {
      type: z.string(),
      description: "Message to process",
    },
  };

  async execute(input: ExampleInput) {
    return `Processed: ${input.message}`;
  }
}

export default ExampleTool;
```

### 3. Create a Prompt:

```typescript
import { MCPPrompt } from "mcp-framework";
import { z } from "zod";

interface GreetingInput {
  name: string;
  language?: string;
}

class GreetingPrompt extends MCPPrompt<GreetingInput> {
  name = "greeting";
  description = "Generate a greeting in different languages";

  schema = {
    name: {
      type: z.string(),
      description: "Name to greet",
      required: true,
    },
    language: {
      type: z.string().optional(),
      description: "Language for greeting",
      required: false,
    },
  };

  async generateMessages({ name, language = "English" }: GreetingInput) {
    return [
      {
        role: "user",
        content: {
          type: "text",
          text: `Generate a greeting for ${name} in ${language}`,
        },
      },
    ];
  }
}

export default GreetingPrompt;
```

### 4. Create a Resource:

```typescript
import { MCPResource, ResourceContent } from "mcp-framework";

class ConfigResource extends MCPResource {
  uri = "config://app/settings";
  name = "Application Settings";
  description = "Current application configuration";
  mimeType = "application/json";

  async read(): Promise<ResourceContent[]> {
    const config = {
      theme: "dark",
      language: "en",
    };

    return [
      {
        uri: this.uri,
        mimeType: this.mimeType,
        text: JSON.stringify(config, null, 2),
      },
    ];
  }
}

export default ConfigResource;
```

## Project Structure

```
your-project/
├── src/
│   ├── tools/          # Tool implementations
│   │   └── ExampleTool.ts
│   ├── prompts/        # Prompt implementations
│   │   └── GreetingPrompt.ts
│   ├── resources/      # Resource implementations
│   │   └── ConfigResource.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

## Automatic Feature Discovery

The framework automatically discovers and loads:

- Tools from the `src/tools` directory
- Prompts from the `src/prompts` directory
- Resources from the `src/resources` directory

Each feature should be in its own file and export a default class that extends the appropriate base class:

- `MCPTool` for tools
- `MCPPrompt` for prompts
- `MCPResource` for resources

### Base Classes

#### MCPTool

- Handles input validation using Zod
- Provides error handling and response formatting
- Includes fetch helper for HTTP requests

#### MCPPrompt

- Manages prompt arguments and validation
- Generates message sequences for LLM interactions
- Supports dynamic prompt templates

#### MCPResource

- Exposes data through URI-based system
- Supports text and binary content
- Optional subscription capabilities for real-time updates

## Type Safety

All features use Zod for runtime type validation and TypeScript for compile-time type checking. Define your input schemas using Zod types:

```typescript
schema = {
  parameter: {
    type: z.string().email(),
    description: "User email address",
  },
  count: {
    type: z.number().min(1).max(100),
    description: "Number of items",
  },
};
```

## License

MIT
