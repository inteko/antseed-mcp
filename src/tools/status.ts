import { clean, fields } from "../format";
import { defineTool, readOnly } from "./tool";

type Status = {
  version?: string;
  publicUrl?: string;
  buyer?: { reachable?: boolean; peers?: number; dhtNodes?: number; uptimeMs?: number };
  spendFeed?: string;
  exposure?: { mode?: string; reachableFromInternet?: boolean };
};

export const status = defineTool({
  name: "status",
  title: "Gateway status",
  description: "Gateway version, buyer reachability, visible sellers and DHT nodes, exposure mode.",
  inputSchema: {},
  annotations: readOnly("Gateway status"),
  async run(_args, { client, config }) {
    const s = await client.get<Status>("/status");
    return [
      `gateway ${config.url}: ${fields([["version", clean(s.version)], ["publicUrl", clean(s.publicUrl, 120)]])}`,
      `buyer: ${fields([
        ["", s.buyer?.reachable ? "reachable" : "UNREACHABLE"],
        ["peers", s.buyer?.peers],
        ["DHT nodes", s.buyer?.dhtNodes],
        ["uptime h", typeof s.buyer?.uptimeMs === "number" ? (s.buyer.uptimeMs / 3_600_000).toFixed(1) : ""],
      ])}`,
      fields([
        ["exposure", clean(s.exposure?.mode) + (s.exposure?.reachableFromInternet ? " (internet)" : "")],
        ["spendFeed", clean(s.spendFeed)],
      ]),
    ]
      .filter(Boolean)
      .join("\n");
  },
});
