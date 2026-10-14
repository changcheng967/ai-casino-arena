// Probe every model on ALL providers (NIM + Groq + Agnes + Cline + Ollama):
// can it chat and follow strict JSON? Duplicates are routed to the better
// provider (capacity first — a 24/7 arena needs requests-per-day headroom —
// then latency). Writes data/roster.json used to seed the arena roster.

import "./loadEnv";
import { nimChat, extractJson, listNimModels, listGroqModels, listAgnesModels, listClineFreeModels, NimError, Provider } from "../lib/nim/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ProbeResult {
  id: string;
  modelRef: string;
  provider: Provider;
  chatCapable: boolean;
  latencyMs: number | null;
  rpd: number | null; // requests-per-day limit (from response headers, Groq)
  error?: string;
  errorKind?: string;
  note?: string;
  sample?: string;
}

const PROBE_USER = `Reply with exactly this JSON object and nothing else: {"ok":true}`;

const NON_CHAT = /whisper|orpheus|guard|safeguard|tts|embed|parse|reward|translate|nvclip|detector|deplot|fuyu|kosmos|vila|neva/i;

async function probeOne(provider: Provider, id: string): Promise<ProbeResult> {
  const base: ProbeResult = {
    id,
    modelRef: id,
    provider,
    chatCapable: false,
    latencyMs: null,
    rpd: null,
  };
  try {
    const r = await nimChat({
      model: id,
      provider,
      user: PROBE_USER,
      maxTokens: 400,
      temperature: 0,
      timeoutMs: provider === "groq" ? 20_000 : 30_000,
      retries: 1,
    });
    const rpdRaw = r.rateLimit?.limitRequests;
    const rpd = rpdRaw ? Number(rpdRaw) : null;
    const parsed = extractJson(r.text);
    const ok = parsed !== null;
    return {
      ...base,
      chatCapable: ok,
      latencyMs: r.latencyMs,
      rpd: Number.isFinite(rpd as number) ? (rpd as number) : null,
      sample: r.text.slice(0, 100),
      error: ok ? undefined : "no parsable JSON",
      errorKind: ok ? undefined : "invalid",
    };
  } catch (e: any) {
    const kind = e instanceof NimError ? e.kind : "unknown";
    return { ...base, error: String(e?.message ?? e).slice(0, 200), errorKind: kind };
  }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (queue.length) out.push(await fn(queue.shift()!));
    }),
  );
  return out;
}

async function main() {
  const outPath = join(process.cwd(), "data", "roster.json");
  mkdirSync(join(process.cwd(), "data"), { recursive: true });

  // ---- NIM ----
  let nimIds: string[] = [];
  try {
    nimIds = await listNimModels();
    console.log(`NIM: fetched ${nimIds.length} models`);
  } catch (e) {
    console.error("NIM list failed:", e);
  }
  const nimResults = await pool(nimIds, 6, (id) => probeOne("nim", id));
  let i = 0;
  for (const r of nimResults) {
    i++;
    console.log(`[nim ${String(i).padStart(2)}/${nimIds.length}] ${r.chatCapable ? `OK  ${String(r.latencyMs).padStart(6)}ms` : `FAIL(${r.errorKind})`}  ${r.id}`);
  }

  // ---- Groq ----
  let groqIds: string[] = [];
  try {
    groqIds = (await listGroqModels()).filter((id) => !NON_CHAT.test(id));
    console.log(`\nGroq: fetched ${groqIds.length} chat candidates`);
  } catch (e) {
    console.error("Groq list failed:", e);
  }
  const groqResults = await pool(groqIds, 4, (id) => probeOne("groq", id));
  i = 0;
  for (const r of groqResults) {
    i++;
    console.log(`[groq ${String(i).padStart(2)}/${groqIds.length}] ${r.chatCapable ? `OK  ${String(r.latencyMs).padStart(6)}ms rpd=${r.rpd}` : `FAIL(${r.errorKind})`}  ${r.id}`);
  }

  // ---- Agnes AI ----
  // Fixed small catalog; only the two flash text models are free-tier usable
  // (pro-alpha/pro-beta return 403 insufficient_user_quota without a balance).
  let agnesIds: string[] = [];
  try {
    agnesIds = (await listAgnesModels()).filter((id) => NON_CHAT.test(id) === false);
    console.log(`\nAgnes: fetched ${agnesIds.length} chat candidates`);
  } catch (e) {
    console.error("Agnes list failed:", e);
  }
  const agnesResults = await pool(agnesIds, 2, (id) => probeOne("agnes", id));
  i = 0;
  for (const r of agnesResults) {
    i++;
    console.log(`[agnes ${String(i).padStart(2)}/${agnesIds.length}] ${r.chatCapable ? `OK  ${String(r.latencyMs).padStart(6)}ms` : `FAIL(${r.errorKind})`}  ${r.id}`);
  }

  // ---- Cline (OpenRouter-style gateway; ONLY :free-tagged models per policy) ----
  let clineIds: string[] = [];
  try {
    clineIds = await listClineFreeModels();
    console.log(`\nCline: fetched ${clineIds.length} :free-tagged chat candidates`);
  } catch (e) {
    console.error("Cline list failed:", e);
  }
  // same model, different catalog naming across providers → canonical NIM id
  const CLINE_ALIASES: Record<string, string> = {
    "nvidia/nemotron-3.5-lightning": "nvidia/nemotron-3.5-lightning-30b-a3b",
  };
  const clineResults = await pool(clineIds, 3, async (ref) => {
    // roster id is the canonical publisher/model form; modelRef keeps the :free tag
    const r = await probeOne("cline", ref);
    const canonical = ref.replace(/:free$/, "");
    return { ...r, id: CLINE_ALIASES[canonical] ?? canonical, modelRef: ref };
  });
  i = 0;
  for (const r of clineResults) {
    i++;
    console.log(`[cline ${String(i).padStart(2)}/${clineIds.length}] ${r.chatCapable ? `OK  ${String(r.latencyMs).padStart(6)}ms` : `FAIL(${r.errorKind})`}  ${r.modelRef}`);
  }

  // ---- Ollama Cloud (free plan = the -cloud models; catalog doesn't flag
  // them, so this is the empirically verified free list — retired/paid ones
  // fail fast with clear error notes) ----
  const OLLAMA_FREE: Array<[ref: string, canonical: string]> = [
    ["gemma4:31b-cloud", "google/gemma-4-31b-it"],
    ["gpt-oss:120b-cloud", "openai/gpt-oss-120b"],
    ["gpt-oss:20b-cloud", "openai/gpt-oss-20b"],
    ["nemotron-3-nano:30b-cloud", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"],
    ["nemotron-3-super:cloud", "nvidia/nemotron-3-super-120b-a12b"],
    ["nemotron-3-ultra:cloud", "nvidia/nemotron-3-ultra-550b-a55b"],
  ];
  const ollamaResults = await pool(OLLAMA_FREE, 3, async ([ref, canonical]) => {
    const r = await probeOne("ollama", ref);
    return { ...r, id: canonical, modelRef: ref };
  });
  i = 0;
  for (const r of ollamaResults) {
    i++;
    console.log(`[ollama ${String(i).padStart(2)}/${OLLAMA_FREE.length}] ${r.chatCapable ? `OK  ${String(r.latencyMs).padStart(6)}ms` : `FAIL(${r.errorKind})`}  ${r.modelRef}`);
  }

  // ---- merge: one entry per model id; duplicates route to the better provider ----
  // A model can exist on several providers (nim/groq/agnes/cline/ollama);
  // the same underlying LLM on several providers becomes SEPARATE players —
  // one seat per (provider, modelRef). The seed keys them `provider:modelRef`,
  // so nothing is dropped or merged here: every capable entry is a player.
  const results: ProbeResult[] = [...nimResults, ...groqResults, ...agnesResults, ...clineResults, ...ollamaResults];

  results.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(outPath, JSON.stringify({ probedAt: new Date().toISOString(), results }, null, 2));
  const capable = results.filter((r) => r.chatCapable);
  console.log(`\nDone: ${capable.length}/${results.length} models are chat-capable.`);
  for (const c of capable) console.log(`  ${c.provider.padEnd(4)} ${String(c.latencyMs).padStart(6)}ms  ${c.id}`);
  console.log(`Roster written to ${outPath}`);
}

main();
