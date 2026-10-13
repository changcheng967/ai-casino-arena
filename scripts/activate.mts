import "./loadEnv";
const { DevRepo } = await import("../lib/arena/store-dev");
const repo = new DevRepo();
await repo.patchModel("meta/llama-3.2-90b-vision-instruct", { status: "active", chatCapable: true, probeLatencyMs: 8019 });
await repo.patchModel("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", { status: "active", chatCapable: true, probeLatencyMs: 411 });
const ms = await repo.listModels();
console.log("active:", ms.filter(m => m.status === "active").length);
