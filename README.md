# MCP Framework

MCP-Framework is a framework for building Model Context Protocol (MCP) servers elegantly in TypeScript.

MCP-Framework gives you architecture out of the box, with automatic directory-based discovery for tools, resources, and prompts. Use our powerful MCP abstractions to define tools, resources, or prompts in an elegant way. Our cli makes getting started with your own MCP server a breeze
## Features

- Automatic discovery and loading of tools, resources, and prompts
- Multiple transport support (stdio, SSE)
- TypeScript-first development with full type safety
- Built on the official MCP SDK
- Easy-to-use base classes for tools, prompts, and resources
- Optional authentication for SSE endpoints

## Installation

```bash
npm install mcp-framework
```

## Quick Start

### Creating a Tool

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

### Setting up the Server

```typescript
import { MCPServer } from "mcp-framework";

const server = new MCPServer();

// OR (mutually exclusive!) with SSE transport
const server = new MCPServer({
  transport: {
    type: "sse",
    options: {
      port: 8080            // Optional (default: 8080)
    }
  }
});

// Start the server
await server.start();
```

## Transport Configuration

### stdio Transport (Default)

The stdio transport is used by default if no transport configuration is provided:

```typescript
const server = new MCPServer();
// or explicitly:
const server = new MCPServer({
  transport: { type: "stdio" }
});
```

### SSE Transport

To use Server-Sent Events (SSE) transport:

```typescript
const server = new MCPServer({
  transport: {
    type: "sse",
    options: {
      port: 8080,            // Optional (default: 8080)
      endpoint: "/sse",      // Optional (default: "/sse")
      messageEndpoint: "/messages" // Optional (default: "/messages")
    }
  }
});
```

## Authentication

MCP Framework provides optional authentication for SSE endpoints. You can choose between JWT and API Key authentication, or implement your own custom authentication provider.

### JWT Authentication

```typescript
import { MCPServer, JWTAuthProvider } from "mcp-framework";
import { Algorithm } from "jsonwebtoken";

const server = new MCPServer({
  transport: {
    type: "sse",
    options: {
      auth: {
        provider: new JWTAuthProvider({
          secret: process.env.JWT_SECRET,
          algorithms: ["HS256" as Algorithm], // Optional (default: ["HS256"])
          headerName: "Authorization"         // Optional (default: "Authorization")
        }),
        endpoints: {
          sse: true,      // Protect SSE endpoint (default: false)
          messages: true  // Protect message endpoint (default: true)
        }
      }
    }
  }
});
```

Clients must include a valid JWT token in the Authorization header:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### API Key Authentication

```typescript
import { MCPServer, APIKeyAuthProvider } from "mcp-framework";

const server = new MCPServer({
  transport: {
    type: "sse",
    options: {
      auth: {
        provider: new APIKeyAuthProvider({
          keys: [process.env.API_KEY],
          headerName: "X-API-Key" // Optional (default: "X-API-Key")
        })
      }
    }
  }
});
```

Clients must include a valid API key in the X-API-Key header:
```
X-API-Key: your-api-key
```

### Custom Authentication

You can implement your own authentication provider by implementing the `AuthProvider` interface:

```typescript
import { AuthProvider, AuthResult } from "mcp-framework";
import { IncomingMessage } from "node:http";

class CustomAuthProvider implements AuthProvider {
  async authenticate(req: IncomingMessage): Promise<boolean | AuthResult> {
    // Implement your custom authentication logic
    return true;
  }

  getAuthError() {
    return {
      status: 401,
      message: "Authentication failed"
    };
  }
}
```

## License

MIT
