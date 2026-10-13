// Table personas: deterministic from model id, for flavor in prompts and the UI.

export interface Persona {
  style: string; // coaching hint in the decision prompt
  vibe: string; // shown in the UI
}

const PERSONAS: Persona[] = [
  { style: "Loose-aggressive: raise often, bluff with a story, pressure passive players.", vibe: "The Wrecker" },
  { style: "Tight-aggressive: wait for strong starting hands, then bet hard.", vibe: "The Surgeon" },
  { style: "Calculating and patient: rely on pot odds and equity, fold marginal spots.", vibe: "The Actuary" },
  { style: "Tricky: slow-play monsters, mix in traps, keep opponents guessing.", vibe: "The Grifter" },
  { style: "Fearless gambler: call down light, chase draws, gamble it up.", vibe: "The Degen" },
  { style: "Machine-precise: play exactly by the numbers, no ego.", vibe: "The Machine" },
  { style: "Chatty showman: entertain the rail, play splashy for the crowd.", vibe: "The Showman" },
  { style: "Cold-blooded pro: punish weakness, value-bet relentlessly, never bluff-catch light.", vibe: "The Iceman" },
];

export function personaFor(modelId: string): Persona {
  let h = 0;
  for (let i = 0; i < modelId.length; i++) h = (h * 31 + modelId.charCodeAt(i)) >>> 0;
  return PERSONAS[h % PERSONAS.length];
}
