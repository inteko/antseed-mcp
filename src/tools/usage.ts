import { z } from "zod";
import { fetchPeers, nameIndex } from "../catalog";
import { clean, compactJson, count, fields, limited, table, time, usd } from "../format";
import { defineTool, readOnly } from "./tool";

type Totals = { requests?: number; failedRequests?: number; spent?: string; inputTokens?: number; cachedInputTokens?: number; outputTokens?: number };
type Usage = { from?: number; to?: number; totals?: Totals; groups?: Array<Totals & { group?: string; label?: string }> };
type Request = {
  tag?: string;
  startedAt?: number;
  keyLabel?: string;
  method?: string;
  path?: string;
  model?: string | null;
  status?: number;
  sellerPeerId?: string | null;
  latencyMs?: number | null;
  spent?: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

const GROUPS = ["hour", "day", "model", "key", "member", "peer", "workspace", "user"] as const;
const when = z.union([z.number().int().nonnegative(), z.string().min(1)]).optional();
/** `in/cached/out` token counts, empty when none is known. */
const tokens = (t: Pick<Totals, "inputTokens" | "cachedInputTokens" | "outputTokens">) =>
  t.inputTokens == null && t.cachedInputTokens == null && t.outputTokens == null ? "" : `${count(t.inputTokens)}/${count(t.cachedInputTokens)}/${count(t.outputTokens)}`;

export const usage = defineTool({
  name: "usage",
  title: "Usage",
  description: "Gateway spend grouped by hour, day, model, key, member, peer, workspace or user. from/to: epoch ms or ISO date (default: last 30 days).",
  inputSchema: {
    groupBy: z.enum(GROUPS),
    from: when.describe("epoch ms or ISO date"),
    to: when.describe("epoch ms or ISO date"),
    limit: z.number().int().positive().max(500).default(30),
  },
  annotations: readOnly("Usage"),
  async run(args, { client }) {
    const [data, peers] = await Promise.all([
      client.get<Usage>("/usage", { groupBy: args.groupBy, from: args.from, to: args.to }),
      args.groupBy === "peer" ? fetchPeers(client) : Promise.resolve([]),
    ]);
    const names = nameIndex(peers);
    const t = data.totals ?? {};
    const groups = [...(data.groups ?? [])].sort((a, b) => Number(b.spent ?? 0) - Number(a.spent ?? 0));
    const { shown, more } = limited(groups, args.limit);
    return [
      `${time(data.from)} to ${time(data.to)}: ${fields([
        ["requests", t.requests ?? 0],
        ["failed", t.failedRequests ?? 0],
        ["spent", t.spent == null ? "" : `$${usd(t.spent)}`],
        ["tokens in/cached/out", tokens(t)],
      ])}`,
      "",
      table(
        [args.groupBy, "requests", "failed", "spent $", "tokens in/cached/out"],
        shown.map((g) => {
          const name = args.groupBy === "peer" ? names.get((g.group ?? "").toLowerCase()) : undefined;
          return [`${clean(g.label ?? g.group, 80)}${name ? ` (${clean(name, 40)})` : ""}`, String(g.requests ?? 0), String(g.failedRequests ?? 0), usd(g.spent), tokens(g)];
        }),
      ) + more,
    ].join("\n");
  },
});

const PAGE = 200;
const MAX_PAGES = 5;
const failed = (r: Request) => (r.status ?? 0) >= 400 || Boolean(r.errorCode);

export const recent_requests = defineTool({
  name: "recent_requests",
  title: "Request log",
  description: "Latest gateway requests, newest first: key, path, model, status, seller, latency, cost, tokens, error. failedOnly keeps errors (scans up to 1000 requests).",
  inputSchema: {
    limit: z.number().int().positive().max(200).default(20),
    failedOnly: z.boolean().default(false),
  },
  annotations: readOnly("Request log"),
  async run(args, { client }) {
    const found: Request[] = [];
    let before: string | undefined;
    for (let page = 0; page < (args.failedOnly ? MAX_PAGES : 1); page++) {
      const data = await client.get<{ requests?: Request[]; nextBefore?: string | null }>("/requests", { limit: args.failedOnly ? PAGE : args.limit, before });
      found.push(...(data.requests ?? []).filter((r) => !args.failedOnly || failed(r)));
      before = data.nextBefore ?? undefined;
      if (found.length >= args.limit || !before) break;
    }
    const rows = found.slice(0, args.limit);
    if (!rows.length) return args.failedOnly ? "No failed requests among the latest." : "Request log is empty.";
    const names = rows.some((r) => r.sellerPeerId) ? nameIndex(await fetchPeers(client)) : new Map<string, string>();
    return table(
      ["time", "key", "request", "model", "status", "seller", "ms", "cost $", "tokens in/cached/out", "error"],
      rows.map((r) => [
        time(r.startedAt),
        clean(r.keyLabel, 30),
        `${clean(r.method, 8)} ${clean(r.path, 40)}`.trim(),
        clean(r.model, 40),
        String(r.status ?? ""),
        r.sellerPeerId ? `${clean(names.get(r.sellerPeerId.toLowerCase()), 30) || "?"} ${r.sellerPeerId}` : "",
        String(r.latencyMs ?? ""),
        usd(r.spent),
        tokens(r),
        r.errorCode || r.errorMessage ? `${clean(r.errorCode, 30)} ${clean(r.errorMessage, 120)}`.trim() : "",
      ]),
    );
  },
});

type RequestDetail = Request & {
  finishedAt?: number | null;
  workspaceId?: string;
  endUser?: string | null;
  firstTokenMs?: number | null;
  tokensPerSecond?: number | null;
  costPending?: boolean;
  routeSelection?: unknown;
};

export const request = defineTool({
  name: "request",
  title: "Request",
  description: "One logged request by tag: timings, seller, cost, tokens, error and routeSelection (why routing picked the seller). Bodies are never shown.",
  inputSchema: { tag: z.string().regex(/^gw_[A-Za-z0-9-]+$/, "tag like gw_…").describe("Tag (gw_…) from recent_requests") },
  annotations: readOnly("Request"),
  async run(args, { client }) {
    const r = await client.get<RequestDetail>(`/requests/${encodeURIComponent(args.tag)}`);
    const names = r.sellerPeerId ? nameIndex(await fetchPeers(client)) : new Map<string, string>();
    const seller = r.sellerPeerId ? `${clean(names.get(r.sellerPeerId.toLowerCase()), 40) || "?"} ${r.sellerPeerId}` : "";
    return [
      `${clean(r.tag, 60)}: ${fields([
        ["", `${clean(r.method, 8)} ${clean(r.path, 60)}`.trim()],
        ["model", clean(r.model, 60)],
        ["status", r.status ?? (r.finishedAt ? "" : "in progress")],
      ])}`,
      fields([
        ["started", time(r.startedAt)],
        ["finished", time(r.finishedAt)],
        ["latency ms", r.latencyMs],
        ["first token ms", r.firstTokenMs],
        ["tok/s", r.tokensPerSecond],
      ]),
      fields([
        ["key", clean(r.keyLabel, 40)],
        ["workspace", clean(r.workspaceId, 40)],
        ["endUser", clean(r.endUser, 60)],
      ]),
      fields([
        ["seller", seller],
        ["cost", r.costPending ? "pending" : r.spent == null ? "" : `$${usd(r.spent)}`],
        ["tokens in/cached/out", tokens(r)],
      ]),
      ...(r.errorCode || r.errorMessage ? [`error: ${clean(r.errorCode, 40)} ${clean(r.errorMessage, 400)}`.trim()] : []),
      `routeSelection: ${r.routeSelection == null ? "none (seller pinned or no data)" : compactJson(r.routeSelection, 2000, 4)}`,
    ]
      .filter(Boolean)
      .join("\n");
  },
});
