import { z } from "zod";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ApiError, redact, type Client } from "../client";
import type { Config } from "../config";
import { clean } from "../format";

export type Context = {
  client: Client;
  config: Config;
  /** Clock for cooldown checks; tests pin it. */
  now?: () => number;
};

/** A user-facing failure that is not an API error: bad input, nothing found, refused write. */
export class ToolError extends Error {}

export type Tool<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  /** Returns the text shown to the agent. */
  run(args: z.infer<z.ZodObject<S>>, context: Context): Promise<string>;
};

export const defineTool = <S extends z.ZodRawShape>(tool: Tool<S>): Tool<S> => tool;

const READ_ONLY: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
export const readOnly = (title: string): ToolAnnotations => ({ title, ...READ_ONLY });

/**
 * Validates arguments, runs the tool and turns every failure into an `isError` result instead of an exception.
 * The token is stripped from all output as a last line of defence.
 */
export async function callTool<S extends z.ZodRawShape>(tool: Tool<S>, args: unknown, context: Context): Promise<CallToolResult> {
  const reply = (text: string, isError = false): CallToolResult => ({
    content: [{ type: "text", text: redact(text, context.config.token) }],
    ...(isError ? { isError: true } : {}),
  });
  const parsed = z.object(tool.inputSchema).safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`).join("; ");
    return reply(`Invalid ${tool.name} arguments: ${issues}`, true);
  }
  try {
    return reply(await tool.run(parsed.data as z.infer<z.ZodObject<S>>, context));
  } catch (error) {
    if (error instanceof ApiError) return reply(`AntSeed API error: ${clean(error.message, 500)}`, true);
    if (error instanceof ToolError) return reply(error.message, true);
    return reply(`Internal ${tool.name} error: ${clean((error as Error)?.message ?? error, 500)}`, true);
  }
}
