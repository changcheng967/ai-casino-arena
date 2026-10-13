// Multi-provider OpenAI-compatible chat client (NVIDIA NIM + Groq Cloud + Agnes AI + Cline)
// with timeout, retries, and JSON repair.

export type Provider = "nim" | "groq" | "agnes" | "cline" | "ollama";

export const PROVIDER_BASE: Record<Provider, string> = {
  nim: "https://integrate.api.nvidia.com/v1",
  groq: "https://api.groq.com/openai/v1",
  agnes: "https://apihub.agnes-ai.com/v1",
  cline: "https://api.cline.bot/api/v1",
  ollama: "https://ollama.com/v1",
};

const KEY_ENV: Record<Provider, string> = {
  nim: "NVIDIA_API_KEY",
  groq: "GROQ_API_KEY",
  agnes: "AGNES_API_KEY",
  cline: "CLINE_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

export function providerForModel(id: string): Provider {
  if (id.startsWith("groq/")) return "groq";
  if (id.startsWith("agnes/")) return "agnes";
  return "nim";
}

export type NimErrorKind = "timeout" | "http" | "network" | "invalid";

export class NimError extends Error {
  kind: NimErrorKind;
  status?: number;
  retryAfterMs?: number;
  constructor(kind: NimErrorKind, message: string, status?: number, retryAfterMs?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface NimChatOptions {
  model: string;
  provider?: Provider;
  system?: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
  apiKey?: string;
}

export interface NimChatResult {
  text: string;
  latencyMs: number;
  finishReason: string | null;
  model: string;
  provider: Provider;
  rateLimit?: { limitRequests?: string; remainingRequests?: string; limitTokens?: string; remainingTokens?: string };
}

export function getApiKey(provider: Provider = "nim"): string {
  const k = process.env[KEY_ENV[provider]];
  if (!k) throw new NimError("invalid", `${KEY_ENV[provider]} is not set`);
  return k;
}

export async function nimChat(opts: NimChatOptions): Promise<NimChatResult> {
  const provider = opts.provider ?? "nim";
  const apiKey = opts.apiKey ?? getApiKey(provider);
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const retries = opts.retries ?? 1;

  const body = {
    model: opts.model,
    messages: [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 300,
    temperature: opts.temperature ?? 0.4,
    stream: false,
  };

  let lastErr: NimError | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const wait = lastErr?.retryAfterMs ?? 900 * 2 ** (attempt - 1);
      await sleep(wait);
    }
    const started = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${PROVIDER_BASE[provider]}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        const retryAfter = res.headers.get("retry-after");
        const retryAfterMs = retryAfter ? parseFloat(retryAfter) * 1000 : undefined;
        const errText = await res.text().catch(() => "");
        const err = new NimError(
          "http",
          `HTTP ${res.status} from ${provider}:${opts.model}: ${errText.slice(0, 300)}`,
          res.status,
          retryAfterMs,
        );
        // Retry only transient server/rate problems, never 4xx config errors.
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }

      const h = res.headers;
      const rateLimit = {
        limitRequests: h.get("x-ratelimit-limit-requests") ?? undefined,
        remainingRequests: h.get("x-ratelimit-remaining-requests") ?? undefined,
        limitTokens: h.get("x-ratelimit-limit-tokens") ?? undefined,
        remainingTokens: h.get("x-ratelimit-remaining-tokens") ?? undefined,
      };
      const json = (await res.json()) as any;
      // Cline wraps the standard body in an extra {data: ...} envelope.
      const cj = json?.data?.choices ? json.data : json;
      const choice = cj?.choices?.[0];
      const text: string = choice?.message?.content ?? "";
      return {
        text,
        latencyMs,
        finishReason: choice?.finish_reason ?? null,
        model: opts.model,
        provider,
        rateLimit,
      };
    } catch (e: any) {
      if (e instanceof NimError) throw e;
      if (e?.name === "AbortError") {
        const err = new NimError("timeout", `${provider}:${opts.model} timed out after ${timeoutMs}ms`);
        if (attempt < retries) {
          lastErr = err;
          continue;
        }
        throw err;
      }
      const err = new NimError("network", `${provider}:${opts.model} network error: ${e?.message ?? e}`);
      if (attempt < retries) {
        lastErr = err;
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new NimError("network", "unreachable");
}

// Extract the first balanced JSON object from LLM output (handles ```json fences, prose).
export function extractJson(text: string): any | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates: string[] = [];
  if (fenced) candidates.push(fenced[1]);
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch {
      /* try next */
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function listNimModels(apiKey?: string): Promise<string[]> {
  const res = await fetch(`${PROVIDER_BASE.nim}/models`, {
    headers: { Authorization: `Bearer ${apiKey ?? getApiKey("nim")}` },
  });
  if (!res.ok) throw new NimError("http", `models list HTTP ${res.status}`, res.status);
  const json = (await res.json()) as any;
  return (json?.data ?? []).map((m: any) => m.id as string).sort();
}

export async function listGroqModels(apiKey?: string): Promise<string[]> {
  const res = await fetch(`${PROVIDER_BASE.groq}/models`, {
    headers: { Authorization: `Bearer ${apiKey ?? getApiKey("groq")}` },
  });
  if (!res.ok) throw new NimError("http", `groq models list HTTP ${res.status}`, res.status);
  const json = (await res.json()) as any;
  return (json?.data ?? []).map((m: any) => m.id as string).sort();
}

export async function listAgnesModels(apiKey?: string): Promise<string[]> {
  const res = await fetch(`${PROVIDER_BASE.agnes}/models`, {
    headers: { Authorization: `Bearer ${apiKey ?? getApiKey("agnes")}` },
  });
  if (!res.ok) throw new NimError("http", `agnes models list HTTP ${res.status}`, res.status);
  const json = (await res.json()) as any;
  return (json?.data ?? [])
    .filter((m: any) => (m?.supported_endpoint_types ?? ["openai"]).includes("openai"))
    .map((m: any) => m.id as string)
    .sort();
}

// Cline's catalog mirrors OpenRouter (461+ models). For the arena we only use
// the :free-tagged chat models — the rest need paid credits (HTTP 402).
export async function listClineFreeModels(apiKey?: string): Promise<string[]> {
  const res = await fetch(`${PROVIDER_BASE.cline}/models`, {
    headers: { Authorization: `Bearer ${apiKey ?? getApiKey("cline")}` },
  });
  if (!res.ok) throw new NimError("http", `cline models list HTTP ${res.status}`, res.status);
  const json = (await res.json()) as any;
  const data = json?.data?.length ? json.data : (json?.data ?? []);
  return (Array.isArray(data) ? data : [])
    .map((m: any) => m.id as string)
    .filter((id: string) => id.endsWith(":free"))
    .filter((id: string) => !/content-safety|guard|embed|image|video|audio|whisper|tts/i.test(id))
    .sort();
}
