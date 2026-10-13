import { describe, it, expect } from "vitest";
import { eloDeltas, rankByNetBB, applyDeltas, eloPairUpdate, pairwiseScore, kDynamic, EloPlayer } from "./elo";

const P = (id: string, rating: number, careerHands = 600): EloPlayer => ({
  id,
  rating,
  sessionsPlayed: 100,
  careerHands,
});

describe("rankByNetBB", () => {
  it("ranks by netBB descending with shared ranks for ties", () => {
    const r = rankByNetBB([
      { id: "a", netBB: 50 },
      { id: "b", netBB: -10 },
      { id: "c", netBB: 50 },
      { id: "d", netBB: 0 },
    ]);
    expect(r.get("a")).toBe(1);
    expect(r.get("c")).toBe(1);
    expect(r.get("d")).toBe(3);
    expect(r.get("b")).toBe(4);
  });
});

describe("kDynamic", () => {
  it("is max for brand-new players and decays smoothly with career hands", () => {
    expect(kDynamic(P("new", 1200, 0))).toBe(120);
    expect(kDynamic(P("half", 1200, 300))).toBeCloseTo(60);
    expect(kDynamic(P("old", 1200, 3000))).toBe(32); // clamped at the floor
  });
});

describe("pairwiseScore (z-filter)", () => {
  it("returns 0.5 for an exact tie (no evidence either way)", () => {
    expect(pairwiseScore(0, 10, 0, 10)).toBeCloseTo(0.5, 1);
  });
  it("is symmetric: S(a,b) = 1 − S(b,a)", () => {
    const s = pairwiseScore(30, 12, -5, 8);
    expect(s).toBeCloseTo(1 - pairwiseScore(-5, 8, 30, 12), 6);
  });
  it("damps a short luck spike less than sustained dominance at the same rate", () => {
    // +40bb over 2 hands is weaker evidence than +400bb over 20 hands at the same 20bb/h rate
    const spike = pairwiseScore(40, 2, 0, 2);
    const sustained = pairwiseScore(400, 20, 0, 20);
    expect(spike).toBeGreaterThan(0.5);
    expect(spike).toBeLessThan(sustained);
    expect(sustained).toBeGreaterThan(0.97);
  });
});

describe("eloDeltas fairness", () => {
  it("is exactly zero-sum (pair-averaged K)", () => {
    const players = [P("a", 1200, 0), P("b", 1150, 900), P("c", 1300, 40), P("d", 1250, 5000)];
    const ranks = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    const d = eloDeltas(players, ranks);
    const sum = [...d.values()].reduce((x, y) => x + y, 0);
    expect(Math.abs(sum)).toBeLessThan(0.05);
  });

  it("winner gains, last loses; gains scale with opponent strength", () => {
    const players = [P("weak", 1000), P("strong", 1400)];
    const ranks = new Map([
      ["weak", 1],
      ["strong", 2],
    ]);
    const d = eloDeltas(players, ranks);
    expect(d.get("weak")!).toBeGreaterThan(0);
    expect(d.get("strong")!).toBeLessThan(0);
    // upset win worth much more than the favorite's win would be
    const d2 = eloDeltas(players, new Map([["weak", 2], ["strong", 1]]));
    expect(d2.get("strong")!).toBeGreaterThan(0);
    expect(d.get("weak")!).toBeGreaterThan(d2.get("strong")!);
  });

  it("farming much weaker tables pays almost nothing", () => {
    const players = [P("shark", 1600), P("fish1", 900), P("fish2", 850), P("fish3", 1000)];
    const ranks = new Map([
      ["shark", 1],
      ["fish1", 2],
      ["fish2", 3],
      ["fish3", 4],
    ]);
    const d = eloDeltas(players, ranks);
    expect(d.get("shark")!).toBeLessThan(6); // crushing three 900s: barely +5
  });

  it("tied ranks exchange nothing", () => {
    const players = [P("a", 1200), P("b", 1000)];
    const d = eloDeltas(players, new Map([["a", 1], ["b", 1]]));
    expect(d.get("a")).toBe(0);
    expect(d.get("b")).toBe(0);
  });

  it("dynamic K gives bigger moves for new players (same rule for all)", () => {
    const players = [P("new", 1200, 0), P("old", 1200, 600)];
    const ranks = new Map([["new", 1], ["old", 2]]);
    const d = eloDeltas(players, ranks);
    // pair K = (120 + 40)/2 = 80; score 1, E = 0.5 → ±40, exactly zero-sum
    expect(d.get("new")!).toBeCloseTo(40);
    expect(d.get("old")!).toBeCloseTo(-40);
  });

  it("applyDeltas rounds and preserves order of magnitude", () => {
    const players = [P("a", 1200), P("b", 1200)];
    const out = applyDeltas(players, new Map([["a", 12.34], ["b", -12.34]]));
    expect(out[0].rating).toBe(1212.34);
    expect(out[1].rating).toBe(1187.66);
  });
});

describe("eloPairUpdate zero-sum", () => {
  it("moves both sides by equal magnitude for any score", () => {
    const [dA, dB] = eloPairUpdate(P("a", 1250, 10), P("b", 1100, 2000), 0.87, 0.25);
    expect(dA).toBeCloseTo(-dB, 6);
  });
});
