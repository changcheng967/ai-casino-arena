import { describe, it, expect } from "vitest";
import { eloDeltas, rankByNetBB, applyDeltas, eloPairUpdate, pairwiseScorePair, kDynamic, EloPlayer } from "./elo";

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
    expect(kDynamic(P("new", 1200, 0))).toBe(160);
    expect(kDynamic(P("half", 1200, 300))).toBeCloseTo(80);
    expect(kDynamic(P("old", 1200, 3000))).toBe(32); // clamped at the floor
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
    // pair K = (160 + 40)/2 = 100; score 1, E = 0.5 → ±50, exactly zero-sum
    expect(d.get("new")!).toBeCloseTo(53.33, 1);
    expect(d.get("old")!).toBeCloseTo(-53.33, 1);
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


describe("pairwiseScorePair (shrunk effect-size)", () => {
  it("treats a short luck spike as (almost) no evidence", () => {
    // +29bb over 2 shared hands — old significance-S scored this ~0.87;
    // the shrunk estimator moves it a couple of points at most
    expect(pairwiseScorePair(29, 2)).toBeLessThan(0.56);
  });
  it("is symmetric via sign: no edge -> ~0.5, sign flips the side", () => {
    expect(pairwiseScorePair(0, 50)).toBeCloseTo(0.5, 3);
    const s = pairwiseScorePair(120, 100);
    expect(s).toBeGreaterThan(0.5);
    expect(pairwiseScorePair(-120, 100)).toBeCloseTo(1 - s, 6);
  });
  it("has a stable fixed point: more of the SAME rate barely moves S", () => {
    const s100 = pairwiseScorePair(90, 100); // 0.9bb/h sustained
    const s1000 = pairwiseScorePair(900, 1000); // same rate, 10x evidence
    expect(s100).toBeGreaterThan(0.5);
    expect(s1000).toBeGreaterThan(s100); // sharper estimate, but…
    expect(s1000 - s100).toBeLessThan(0.05); // …converging, not diverging
    expect(s1000).toBeLessThan(0.56); // bounded far from 1.0
  });
  it("separates degenerate strategies clearly", () => {
    // 15bb/h fold-bot edge over 200 shared hands
    expect(pairwiseScorePair(3000, 200)).toBeGreaterThan(0.6);
  });
  it("zero evidence is exactly neutral", () => {
    expect(pairwiseScorePair(0, 0)).toBe(0.5);
  });
});
