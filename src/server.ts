import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { find_peers, model_sellers, peer } from "./tools/sellers";
import { search_models } from "./tools/models";
import { route_preview, routing, routing_allow_peers } from "./tools/routing";
import { status } from "./tools/status";
import { callTool, type Context, type Tool } from "./tools/tool";
import { recent_requests, request, usage } from "./tools/usage";
import { channels, runway, wallet } from "./tools/wallet";

export const READ_TOOLS: Tool<any>[] = [status, model_sellers, find_peers, peer, search_models, routing, route_preview, usage, recent_requests, request, wallet, channels, runway];
export const WRITE_TOOLS: Tool<any>[] = [routing_allow_peers];

/** Write tools are not registered at all without ANTSEED_ALLOW_WRITES=true. */
export const toolsFor = (context: Context) => (context.config.allowWrites ? [...READ_TOOLS, ...WRITE_TOOLS] : READ_TOOLS);

export function createServer(context: Context): McpServer {
  const server = new McpServer({ name: "antseed", version: "0.2.0" });
  for (const tool of toolsFor(context)) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      (args: unknown) => callTool(tool, args, context),
    );
  }
  return server;
}
