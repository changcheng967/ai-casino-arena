const KEY = process.env.CK;
const BASE = "https://api.cline.bot/api/v1";
const MODELS = [
  "cohere/north-mini-code:free",
  "dots-studio/dots-3-note-preview:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "liquid/lfm-2.5-2.6b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3.5-lightning:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "thinkingmachines/inkling-small:free",
  "thinkingmachines/inkling:free",
];
const PROMPT = `Reply with exactly this JSON object and nothing else: {"ok":true}`;
async function once(m) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: m, messages: [{ role: "user", content: PROMPT }], max_tokens: 400, temperature: 0, stream: false }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - t0;
    if (!res.ok) return { ok: false, ms, status: res.status, txt: (await res.text()).slice(0, 110) };
    const j = await res.json();
    const cj = j?.data?.choices ? j.data : j; // cline double-wraps in {data:...}
    const text = cj?.choices?.[0]?.message?.content ?? "";
    return { ok: /\{\s*"ok"\s*:\s*true\s*\}/.test(text), ms, text: text.slice(0, 50) };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, ms: Date.now() - t0, status: 0, txt: String(e?.message ?? e).slice(0, 90) };
  }
}
for (const m of MODELS) {
  let r = await once(m);
  if (!r.ok && (r.status === 500 || r.status === 429)) {
    await new Promise((x) => setTimeout(x, 1500));
    r = await once(m); // one retry for OpenRouter transient 429/5xx
  }
  console.log(`${r.ok ? "OK  " : "FAIL"} ${String(r.ms).padStart(6)}ms  ${m}${r.ok ? "  " + JSON.stringify(r.text) : "  [" + r.status + "] " + (r.txt ?? "")}`);
}
