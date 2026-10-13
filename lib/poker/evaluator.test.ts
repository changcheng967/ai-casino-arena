import { describe, it, expect } from "vitest";
import { evaluate, describe as describeHand } from "./evaluator";
import { cardOf, cardsStr } from "./cards";

const ev = (s: string) => evaluate(s.split(/\s+/).map(cardOf));

describe("evaluator categories", () => {
  it("royal flush beats quads", () => {
    expect(ev("As Ks Qs Js Ts")).toBeGreaterThan(ev("Ac Ad Ah As Kd"));
  });

  it("straight flush beats four of a kind", () => {
    expect(ev("9h 8h 7h 6h 5h 2c 2d")).toBeGreaterThan(ev("Ac Ad Ah As Kd 3c 4d"));
  });

  it("quads beat full house", () => {
    expect(ev("7c 7d 7h 7s Kd 2c 3c")).toBeGreaterThan(ev("Ac Ad Kh Ks Qd 2c 3c"));
  });

  it("full house beats flush", () => {
    expect(ev("2c 2d 2h 4s 4d 9c 3c")).toBeGreaterThan(ev("Ac Kc 9c 6c 3c 2d 2h"));
  });

  it("flush beats straight", () => {
    expect(ev("Ac Kc 9c 6c 3c 2d 5h")).toBeGreaterThan(ev("5h 6d 7c 8s 9d 2c Kh"));
  });

  it("straight beats trips", () => {
    expect(ev("5h 6d 7c 8s 9d 2c Kh")).toBeGreaterThan(ev("2c 2d 2h Ks 9d 4c 5c"));
  });

  it("trips beat two pair", () => {
    expect(ev("2c 2d 2h Ks 9d 4c 5c")).toBeGreaterThan(ev("Ac Ad Kh Ks 9d 4c 5c"));
  });

  it("two pair beats pair", () => {
    expect(ev("Ac Ad Kh Ks 9d 4c 5c")).toBeGreaterThan(ev("Ac Ad Kh 9s 9d 4c 5c"));
  });

  it("kickers break ties within pair", () => {
    expect(ev("Ac Ad Kh 9s 5d 4c 3c")).toBeGreaterThan(ev("Ac Ad Qh 9s 5d 4c 3c"));
  });
});

describe("evaluator straights", () => {
  it("ace-high straight beats king-high straight", () => {
    expect(ev("Th Jh Qd Ks Ac 2c 3d")).toBeGreaterThan(ev("9h Td Jc Qs Kd 2c 3c"));
  });

  it("wheel is the lowest straight", () => {
    expect(ev("Ah 2c 3d 4s 5h Kc Qd")).toBeLessThan(ev("2h 3c 4d 5s 6h Kc Qd"));
    expect(ev("Ah 2c 3d 4s 5h Kc Qd")).toBeGreaterThan(ev("Ac Ad Kh Kc Qd 3s 4d"));
  });

  it("wheel straight flush (steel wheel) loses to six-high straight flush", () => {
    expect(ev("Ah 2h 3h 4h 5h Kc Qd")).toBeLessThan(ev("2s 3s 4s 5s 6s Kc Qd"));
  });

  it("describes royal flush", () => {
    const s = ev("As Ks Qs Js Ts 2c 3d");
    expect(describeHand(s)).toBe("Royal Flush");
  });

  it("describes wheel as A to 5", () => {
    const s = ev("Ah 2c 3d 4s 5h Kc Qd");
    expect(describeHand(s)).toContain("A to 5");
  });
});

describe("evaluator edge cases", () => {
  it("best five of seven: board quads play", () => {
    // 9999 on board + kickers; hole cards irrelevant
    const a = ev("9c 9d 9h 9s Kd 2c 3c");
    const b = ev("9c 9d 9h 9s Kd Qc Jc");
    expect(a).toBe(b); // same quads same kicker
  });

  it("full house picks best trips + best pair", () => {
    // AAA KKK 2 → best is Aces full of Kings
    const s = ev("Ac Ad Ah Ks Kd 2c 3c");
    expect(describeHand(s)).toBe("Full House, As full of Ks");
  });

  it("two pair uses third pair as kicker source", () => {
    // AA KK QQ 2 → kicker Q; AA KK JJ T (no Q anywhere) → kicker T
    const a = ev("Ac Ad Kh Ks Qh Qd 2c");
    const b = ev("Ac Ad Kh Ks Jh Jd Tc");
    expect(describeHand(a)).toBe("Two Pair, As and Ks");
    expect(a).toBeGreaterThan(b);
  });

  it("flush picks top five suited", () => {
    const s = ev("Ac 2c 3c 4c 5c 6c 7c");
    expect(describeHand(s)).toBe("Straight Flush, 7-high");
  });

  it("ties are exactly equal", () => {
    expect(ev("Ac Kd 9h 6s 3c 2d 5h")).toBe(ev("As Kh 9s 6c 3d 2h 5s"));
  });

  it("evaluates all 21 combos consistently (hand vs subset)", () => {
    // pair of aces among 7
    const s = ev("Ac Ad 2h 5s 9c Kd 3d");
    expect(describeHand(s)).toBe("Pair of As");
  });

  it("cardsStr round trip", () => {
    const cs = [12 * 4, 11 * 4 + 1, 5 * 4 + 3].sort((a, b) => b - a);
    expect(cardsStr(cs)).toMatch(/^[AK7][cdhs] [AK7][cdhs] [AK7][cdhs]$/);
  });
});
