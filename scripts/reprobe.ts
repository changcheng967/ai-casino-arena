import "./loadEnv";
import { nimChat, extractJson } from "../lib/nim/client";
const ids = ["deepseek-ai/deepseek-v4.1-flash","meta/llama-3.2-90b-vision-instruct","meta/llama-guard-4-12b","nvidia/llama-3.1-nemoguard-8b-content-safety","nvidia/riva-translate-4b-instruct-v2","nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"];
async function main() {
  for (const id of ids) {
    try {
      const r = await nimChat({ model: id, user: 'Reply with exactly this JSON and nothing else: {"ok":true}', maxTokens: 400, temperature: 0, timeoutMs: 60_000, retries: 2 });
      const ok = extractJson(r.text) !== null;
      console.log(`${ok ? "OK " : "BAD"} ${r.latencyMs}ms  ${id}  ${JSON.stringify(r.text.slice(0, 80))}`);
    } catch (e: any) {
      console.log(`ERR ${id} -> ${String(e.message).slice(0, 130)}`);
    }
  }
}
void main();
