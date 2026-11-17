import { z } from "zod";
import { fetchModels, normalizeModelId, type Model } from "../catalog";
import { clean, limited, table, usd } from "../format";
import { defineTool, readOnly } from "./tool";

const range = (value: { min?: number; max?: number } | undefined) => {
  if (value?.min === undefined && value?.max === undefined) return "";
  return value.min === value.max ? usd(value.min) : `${usd(value.min)}–${usd(value.max)}`;
};

/** Exact normalized match first, then by number of sellers. */
export function searchModels(models: Model[], query: string, type?: string): Model[] {
  const wanted = normalizeModelId(query);
  const lower = query.trim().toLowerCase();
  const names = (model: Model) => [model.id, ...(model.aliases ?? [])].filter((name): name is string => typeof name === "string");
  const score = (model: Model) => {
    if (names(model).some((name) => normalizeModelId(name) === wanted)) return 0;
    if (names(model).some((name) => normalizeModelId(name).includes(wanted))) return 1;
    if (names(model).some((name) => name.toLowerCase().includes(lower)) || (model.name ?? "").toLowerCase().includes(lower)) return 2;
    return undefined;
  };
  return models
    .filter((model) => !type || model.type === type)
    .flatMap((model) => {
      const value = wanted || lower ? score(model) : 2;
      return value === undefined ? [] : [{ model, value }];
    })
    .sort((a, b) => a.value - b.value || (b.model.sellers ?? 0) - (a.model.sellers ?? 0) || a.model.id.localeCompare(b.model.id))
    .map(({ model }) => model);
}

export const search_models = defineTool({
  name: "search_models",
  title: "Find models",
  description: "Search network models by ID, alias or name part (matched loosely). Shows type, seller count and price range; use model_sellers for sellers.",
  inputSchema: {
    query: z.string().min(1).describe("ID, alias or name part"),
    type: z.enum(["text", "image", "video", "speech", "decision"]).optional(),
    limit: z.number().int().positive().max(200).default(20),
  },
  annotations: readOnly("Find models"),
  async run(args, { client }) {
    const found = searchModels(await fetchModels(client), args.query, args.type);
    if (!found.length) return `No models match "${clean(args.query)}".`;
    const { shown, more } = limited(found, args.limit);
    return `found ${found.length}; prices $/1M\n\n${table(
      ["id", "aliases", "type", "sellers (verified)", "in", "out"],
      shown.map((model) => [
        clean(model.id, 80),
        (model.aliases ?? []).slice(0, 4).map((alias) => clean(alias, 40)).join(", "),
        clean(model.type, 10),
        `${model.sellers ?? model.offers?.length ?? 0} (${model.verifiedSellers ?? 0})`,
        range(model.inputUsdPerMillion),
        range(model.outputUsdPerMillion),
      ]),
    )}${more}`;
  },
});
