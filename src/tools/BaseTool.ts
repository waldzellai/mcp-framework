import { z } from "zod";
import { Tool as SDKTool } from "@modelcontextprotocol/sdk/types.js";
import { ImageContent } from "../transports/utils/image-handler.js";

export type ToolInputSchema<T> = {
  [K in keyof T]: {
    type: z.ZodType<T[K]>;
    description: string;
  };
};

export type ToolInput<T extends ToolInputSchema<any>> = {
  [K in keyof T]: z.infer<T[K]["type"]>;
};

export type TextContent = {
  type: "text";
  text: string;
};

export type ErrorContent = {
  type: "error";
  text: string;
};

export type ToolContent = TextContent | ErrorContent | ImageContent;

export type ToolResponse = {
  content: ToolContent[];
};

export interface ToolProtocol extends SDKTool {
  name: string;
  description: string;
  toolDefinition: {
    name: string;
    description: string;
    inputSchema: {
      type: "object";
      properties?: Record<string, unknown>;
    };
  };
  toolCall(request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }): Promise<ToolResponse>;
}

export abstract class MCPTool<TInput extends Record<string, any> = {}>
  implements ToolProtocol
{
  abstract name: string;
  abstract description: string;
  protected abstract schema: ToolInputSchema<TInput>;
  [key: string]: unknown;

  get inputSchema(): { type: "object"; properties?: Record<string, unknown> } {
    return {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(this.schema).map(([key, schema]) => [
          key,
          {
            type: this.getJsonSchemaType(schema.type),
            description: schema.description,
          },
        ])
      ),
    };
  }

  get toolDefinition() {
    return {
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
    };
  }

  protected abstract execute(input: TInput): Promise<unknown>;

  async toolCall(request: {
    params: { name: string; arguments?: Record<string, unknown> };
  }): Promise<ToolResponse> {
    try {
      const args = request.params.arguments || {};
      const validatedInput = await this.validateInput(args);
      const result = await this.execute(validatedInput);
      return this.createSuccessResponse(result);
    } catch (error) {
      return this.createErrorResponse(error as Error);
    }
  }

  private async validateInput(args: Record<string, unknown>): Promise<TInput> {
    const zodSchema = z.object(
      Object.fromEntries(
        Object.entries(this.schema).map(([key, schema]) => [key, schema.type])
      )
    );

    return zodSchema.parse(args) as TInput;
  }

  private getJsonSchemaType(zodType: z.ZodType<any>): string {
    if (zodType instanceof z.ZodString) return "string";
    if (zodType instanceof z.ZodNumber) return "number";
    if (zodType instanceof z.ZodBoolean) return "boolean";
    if (zodType instanceof z.ZodArray) return "array";
    if (zodType instanceof z.ZodObject) return "object";
    return "string";
  }

  protected createSuccessResponse(data: unknown): ToolResponse {
    if (this.isImageContent(data)) {
      return {
        content: [data],
      };
    }

    if (Array.isArray(data)) {
      const validContent = data.filter(item => this.isValidContent(item)) as ToolContent[];
      if (validContent.length > 0) {
        return {
          content: validContent,
        };
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
    };
  }

  protected createErrorResponse(error: Error): ToolResponse {
    return {
      content: [{ type: "error", text: error.message }],
    };
  }

  private isImageContent(data: unknown): data is ImageContent {
    return (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      data.type === "image" &&
      "data" in data &&
      "mimeType" in data &&
      typeof (data as ImageContent).data === "string" &&
      typeof (data as ImageContent).mimeType === "string"
    );
  }

  private isTextContent(data: unknown): data is TextContent {
    return (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      data.type === "text" &&
      "text" in data &&
      typeof (data as TextContent).text === "string"
    );
  }

  private isErrorContent(data: unknown): data is ErrorContent {
    return (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      data.type === "error" &&
      "text" in data &&
      typeof (data as ErrorContent).text === "string"
    );
  }

  private isValidContent(data: unknown): data is ToolContent {
    return (
      this.isImageContent(data) ||
      this.isTextContent(data) ||
      this.isErrorContent(data)
    );
  }

  protected async fetch<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }
}
