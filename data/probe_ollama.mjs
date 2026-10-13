const KEY = process.env.OK;
const BASE = "https://ollama.com/v1";
const CANDIDATES = [
  "gemma4:31b-cloud","gpt-oss:120b-cloud","gpt-oss:20b-cloud",
  "nemotron-3-nano:30b-cloud","nemotron-3-super:cloud","nemotron-3-ultra:cloud",
  "minimax-m2.1:cloud","minimax-m3:cloud","glm-4.7:cloud","glm-5.3:cloud","glm-5.3-flash:cloud",
  "qwen3-next:80b-cloud","qwen3-coder-next:cloud","devstral-2:123b-cloud",
  "cogito-2.1:671b-cloud","qwen3-vl:235b-instruct-cloud",
  "kimi-k3:cloud","kimi-k2.6:cloud","deepseek-v4.1-flash:cloud","mistral-large-4:cloud",
  "minimax-m2.7:cloud","gemma4:26b-cloud","llama-3.3:70b-cloud","qwen3.8:27b-cloud",
];
const PROMPT = `Reply with exactly this JSON object and nothing else: {"ok":true}`;
for (const m of CANDIDATES) {
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
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const msg = (j?.error?.message ?? "").slice(0, 80);
      console.log(`${res.status === 402 ? "PAID" : "FAIL"} ${res.status} ${String(ms).padStart(6)}ms  ${m}  ${msg}`);
      continue;
    }
    const j = await res.json();
    const text = j?.choices?.[0]?.message?.content ?? "";
    const ok = /\{\s*"ok"\s*:\s*true\s*\}/.test(text);
    console.log(`${ok ? "OK  " : "BAD "} ${String(ms).padStart(6)}ms  ${m}  ${JSON.stringify(text.slice(0, 40))}`);
  } catch (e) {
    clearTimeout(timer);
    console.log(`ERR  ${String(Date.now() - t0).padStart(6)}ms  ${m}  ${String(e?.message ?? e).slice(0, 70)}`);
  }
}
