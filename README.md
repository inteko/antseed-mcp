# antseed-mcp

MCP server for the [AntSeed Gateway](https://antseed.com/docs/gateway/management-api/) Management API.
It lets an agent (Claude Desktop, Claude Code, Cursor, VS Code and other MCP clients) browse the network's
sellers and models, compare the sellers of a model by price, trust, audits and health, read spend, the request
log and the routing policy, and, with explicit permission, change the list of allowed sellers.

The server never calls models (`/v1/*`) and never spends wallet money.

You need Node.js 20+ (for `npx`) and a management token for your gateway (`antseed_admin_…`).

## Settings

All settings are environment variables in the `env` block of the client config.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTSEED_URL` | yes | Your gateway address, e.g. `https://gateway.example.com` |
| `ANTSEED_ADMIN_TOKEN` | yes* | Management token `antseed_admin_…` |
| `ANTSEED_ADMIN_TOKEN_FILE` | yes* | Path to a file with the token, instead of `ANTSEED_ADMIN_TOKEN`, to keep the token out of the config |
| `ANTSEED_ALLOW_WRITES` | no | `true` enables policy changes (`routing_allow_peers`). By default the server is read-only |
| `ANTSEED_TIMEOUT_MS` | no | API request timeout, default `30000` |

\* One of the two.

## Claude Desktop

Add this to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows: `%APPDATA%\Claude\claude_desktop_config.json`) and restart Claude Desktop.
More in the [MCP docs for Claude Desktop](https://modelcontextprotocol.io/quickstart/user).

```json
{
  "mcpServers": {
    "antseed": {
      "command": "npx",
      "args": ["-y", "@inteko/antseed-mcp"],
      "env": {
        "ANTSEED_URL": "https://your-gateway.example.com",
        "ANTSEED_ADMIN_TOKEN": "antseed_admin_your_token",
        "ANTSEED_ALLOW_WRITES": "false"
      }
    }
  }
}
```

## Claude Code

```sh
claude mcp add antseed -s user \
  -e ANTSEED_URL=https://your-gateway.example.com \
  -e ANTSEED_ADMIN_TOKEN=antseed_admin_your_token \
  -- npx -y @inteko/antseed-mcp
```

`-s user` adds the server to all projects; without it, only to the current folder.
Check with `claude mcp list` or `/mcp` inside a session. To change settings, run
`claude mcp remove antseed -s user` and add it again.

Or use a `.mcp.json` file in the project root with the same JSON as for Claude Desktop.

## Cursor

`~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` in a project, with the same JSON as for Claude Desktop.

## VS Code

`.vscode/mcp.json` in a project:

```json
{
  "servers": {
    "antseed": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@inteko/antseed-mcp"],
      "env": {
        "ANTSEED_URL": "https://your-gateway.example.com",
        "ANTSEED_ADMIN_TOKEN": "antseed_admin_your_token"
      }
    }
  }
}
```

## OpenCode

The quickest way is the command below. `--global` adds the server to all projects; without it, the entry goes
into the current project's config:

```sh
opencode mcp add antseed --global \
  --env ANTSEED_URL=https://your-gateway.example.com \
  --env ANTSEED_ADMIN_TOKEN_FILE=$HOME/.config/opencode/mcp-secrets/antseed \
  -- npx -y @inteko/antseed-mcp
```

Or edit `~/.config/opencode/opencode.json` (global) or `opencode.json` in the project root by hand.
Servers go in `mcp.servers`, environment variables in `environment`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "antseed": {
        "type": "local",
        "command": ["npx", "-y", "@inteko/antseed-mcp"],
        "environment": {
          "ANTSEED_URL": "https://your-gateway.example.com",
          "ANTSEED_ADMIN_TOKEN_FILE": "/Users/you/.config/opencode/mcp-secrets/antseed",
          "ANTSEED_ALLOW_WRITES": "false"
        }
      }
    }
  }
}
```

Keep the token in a separate file with mode `600` rather than in the config:

```sh
mkdir -p ~/.config/opencode/mcp-secrets
printf '%s' 'antseed_admin_your_token' > ~/.config/opencode/mcp-secrets/antseed
chmod 600 ~/.config/opencode/mcp-secrets/antseed
```

Instead of `ANTSEED_ADMIN_TOKEN_FILE` you can pass the token itself through OpenCode substitution:
`"ANTSEED_ADMIN_TOKEN": "{file:/Users/you/.config/opencode/mcp-secrets/antseed}"` or
`"{env:ANTSEED_ADMIN_TOKEN}"`. A `$VAR` in JSON is not expanded.

To run a local checkout instead of the npm package, set
`"command": ["bun", "/path/to/antseed-mcp/src/index.ts"]`.

Check: `opencode mcp list` should show `✓ antseed connected`; inside OpenCode, `/mcps`.
Tools are named `antseed_<tool>` (e.g. `antseed_wallet`), and in Code Mode
(the default) they are called as `tools.antseed.wallet(...)`. To give them to the model directly,
without Code Mode, add `"codemode": false` to the server.
More in the [OpenCode MCP docs](https://opencode.ai/docs/mcp-servers/).

## Enabling writes

By default the server is read-only: the policy-changing tool is not listed at all.
To let the agent change the list of allowed sellers, set `"ANTSEED_ALLOW_WRITES": "true"`
(in Claude Code `-e ANTSEED_ALLOW_WRITES=true`, in OpenCode `--env ANTSEED_ALLOW_WRITES=true`) and restart the client.

Even then `routing_allow_peers` does a dry run by default and shows the diff; it writes
only with `dryRun: false`. It changes the single field `allowedPeerIds`, keeps the rest of the policy as is,
and refuses to leave the list empty (an empty list would allow every seller). Every write goes
into the gateway audit log.

## Tools

| Tool | What it does |
| --- | --- |
| `status` | Gateway version, buyer reachability, number of sellers and DHT nodes |
| `model_sellers` | All sellers of a model, cheapest first: price, trust, model audit, health, success rate, whether the policy allows it; with `officialInput`/`officialOutput`, price as % of official |
| `find_peers` | Seller search by name, peerId prefix, model, min trust, allowed only |
| `peer` | One seller: trust and its breakdown, verification, model audits, services with prices and health; `links: true` adds audit URLs |
| `search_models` | Network models: seller count and price range |
| `routing` | Current routing policy with the names of allowed sellers |
| `route_preview` | Whom routing would pick for a model: ranked candidates and rejection reasons |
| `usage` | Spend grouped by `hour`, `day`, `model`, `key`, `member`, `peer`, `workspace`, `user` |
| `recent_requests` | Latest requests; `failedOnly` keeps only errors |
| `request` | One request by tag: seller, latency, cost, tokens, `routeSelection` (no request or response bodies) |
| `wallet` | Workspace balance: available, in channels, not credited, limit, deposit status |
| `channels` | Payment channels with sellers: reserved, spent, settled, left |
| `runway` | How many days the balance lasts at the average spend over N days |
| `routing_allow_peers` | Add or remove sellers in `allowedPeerIds` (only with `ANTSEED_ALLOW_WRITES=true`) |

Model IDs are compared after normalization: `grok-4.7`, `grok-4-7` and `xai/grok-4.7` are one model.

Example prompts: "who sells gpt-6-luna and at what price?", "show seller Apex Ant",
"which requests failed in the last hour?", "spend by seller since November 1".

Output is compact to save tokens: tab-separated tables, empty columns dropped, and values shared by
every row shown once above the table.

## Troubleshooting

- The client says the server did not start: run it by hand and read the error on stderr:
  `ANTSEED_URL=https://… ANTSEED_ADMIN_TOKEN=… npx -y @inteko/antseed-mcp`
  (without `ANTSEED_URL` or a token the server says right away what is missing).
- `401`/`403` responses: the token was revoked, expired, or lacks the required scope.
- Claude Desktop cannot find `npx`: put the full path in `command` (the output of `which npx`).

## Development

```sh
git clone https://github.com/inteko/antseed-mcp.git && cd antseed-mcp
bun install
bunx tsc --noEmit   # types
bun test            # tests without network, fixtures in fixtures/
bun run build       # dist/index.js for npm
bunx @modelcontextprotocol/inspector bun src/index.ts   # manual check
```

Code layout and project rules are in [AGENTS.md](AGENTS.md).

## Security

- The token never appears in tool results or error messages.
- Seller names, descriptions and links come from the network and are shown as data, not instructions.
