"use client";

import { cardParts, money, moneyExact } from "@/lib/format";

export interface SeatView {
  seat: number;
  id: string;
  name: string;
  publisher: string;
  elo: number;
  rating?: number;
  bankroll: number;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  satOut: boolean;
  lastAction: string | null;
  holeCards: number[] | null; // revealed at showdown
  holeCardsLive?: number[] | null; // actual cards (god view)
}

export type CardMode = "blind" | "showdown" | "god";

export interface TableView {
  tableId: string;
  tierName: string;
  roomName?: string;
  sb?: number;
  bb?: number;
  sessionId: string;
  handNumber: number;
  maxHands: number;
  street: string;
  board: number[];
  pot: number;
  potDisplay?: number;
  dealerSeat: number;
  currentSeat: number;
  players: SeatView[];
  actionLog?: Array<{
    street: string;
    seat: number;
    playerId: string;
    type: string;
    amount?: number;
    note?: string;
  }>;
  buyIns?: Record<string, number>;
}

// Seats sit in rows above and below the felt (3 up, 3 down), anchored at
// 16% / 50% / 84% and horizontally centered — no overflow past the panel.
const SEAT_ANCHOR = [
  { left: "16%", row: "top" },
  { left: "50%", row: "top" },
  { left: "84%", row: "top" },
  { left: "84%", row: "bottom" },
  { left: "50%", row: "bottom" },
  { left: "16%", row: "bottom" },
] as const;

function Card({ card, small = false }: { card: number; small?: boolean }) {
  const p = cardParts(card);
  return (
    <div className={`poker-card deal-in ${small ? "small" : ""}`}>
      <span className={p.red ? "red" : ""}>
        {p.rank}
        {p.glyph}
      </span>
    </div>
  );
}

function CardBack({ small = false }: { small?: boolean }) {
  return <div className={`poker-card card-back deal-in ${small ? "small" : ""}`} />;
}

export default function PokerTable({
  table,
  cardMode = "showdown",
}: {
  table: TableView;
  cardMode?: CardMode;
}) {
  const active = table.players.filter((p) => !p.satOut);
  return (
    <div className="panel relative overflow-hidden rounded-2xl p-4">
      {/* table header */}
      <div className="mb-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-widest">
        <div className="flex items-center gap-2">
          <span className="rounded bg-gold-500/15 px-2 py-0.5 text-gold-300">{table.roomName ?? table.tierName}</span>
          <span className="text-cream-dim">
            hand {table.handNumber + 1}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {table.street === "showdown" || table.street === "payout" ? (
            <span className="text-gold-300">{table.street}</span>
          ) : (
            <span className="text-neon">
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-neon align-middle" />
              {table.street}
            </span>
          )}
        </div>
      </div>

      {/* table area: seat rows sandwich the felt */}
      <div className="relative py-[4.5rem]">
        {/* felt */}
        <div className="felt-table relative mx-auto aspect-[16/9] w-full rounded-[50%]">
          {/* center: pot + board */}
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
            <div className="font-display text-lg font-bold text-gold-300 drop-shadow">
              POT {money(table.potDisplay ?? table.pot)}
            </div>
            <div className="flex min-h-[3.4rem] items-center gap-1.5">
              {table.board.length === 0 && <span className="font-mono text-[11px] text-cream-dim/50">pre-flop</span>}
              {table.board.map((c) => (
                <Card key={c} card={c} />
              ))}
            </div>
          </div>

          {/* tier watermark */}
          <div className="pointer-events-none absolute left-1/2 top-[70%] -translate-x-1/2 font-display text-2xl italic text-cream/[0.06]">
            ♠ {table.roomName ?? table.tierName} ♦
          </div>
        </div>

        {/* seats */}
        {table.players.map((p) => {
          const anchor = SEAT_ANCHOR[p.seat % 6];
          const isDealer = p.seat === table.dealerSeat;
          const isThinking = p.seat === table.currentSeat;
          const dimmed = p.satOut || p.folded;
          const talk = p.lastAction?.includes("“") ? p.lastAction : null;
          return (
            <div
              key={p.id}
              className="absolute w-[31%] min-w-[8.5rem] max-w-[13rem]"
              style={{
                left: anchor.left,
                [anchor.row]: 0,
                transform: "translateX(-50%)",
              }}
            >
              <div
                className={`relative rounded-xl border px-2.5 py-2 transition-opacity ${
                  isThinking
                    ? "border-neon/60 bg-felt-800/90 shadow-[0_0_24px_rgba(61,255,160,0.25)]"
                    : "border-gold-500/25 bg-ink/70"
                } ${dimmed ? "opacity-45" : ""}`}
              >
                {isDealer && (
                  <span className="absolute -left-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-cream font-mono text-[10px] font-bold text-ink">
                    D
                  </span>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-body text-[13px] font-semibold text-cream">{p.name}</span>
                  <span className="shrink-0 font-mono text-[10px] text-cream-dim/80" title={`arena Elo ${Math.round(p.elo)}`}>
                    {p.rating ?? Math.round(p.elo)}
                  </span>
                </div>
                <div className="truncate font-mono text-[8px] uppercase tracking-wide text-cream-dim/45" title={p.id}>
                  {p.id}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="truncate text-gold-300">{money(p.stack)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {p.bet > 0 && <span className="rounded bg-gold-500/20 px-1.5 text-gold-300">{money(p.bet)}</span>}
                    {p.allIn && !p.satOut && <span className="rounded bg-danger/25 px-1.5 text-danger">AI</span>}
                  </span>
                </div>
                {/* cards + action line side by side */}
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex h-9 shrink-0 items-center gap-1">
                    {p.satOut ? (
                      <span className="font-mono text-[10px] uppercase text-danger/80">busted</span>
                    ) : cardMode === "god" && p.holeCardsLive ? (
                      p.holeCardsLive.map((c) => <Card key={c} card={c} small />)
                    ) : cardMode === "blind" || !p.holeCards ? (
                      <>
                        <CardBack small />
                        <CardBack small />
                      </>
                    ) : (
                      p.holeCards.map((c) => <Card key={c} card={c} small />)
                    )}
                  </div>
                  {!talk && p.lastAction && !dimmed && (
                    <span className="truncate font-mono text-[10px] text-cream-dim/80">{p.lastAction}</span>
                  )}
                </div>
                {talk && (
                  <div className="mt-1 line-clamp-2 rounded-md bg-talk/10 px-2 py-1 font-body text-[11px] italic leading-snug text-talk">
                    {talk}
                  </div>
                )}
                {isThinking && (
                  <div className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-ink/90 px-2 py-0.5 font-mono text-[10px] text-neon thinking hairline">
                    thinking…
                  </div>
                )}
              </div>
              {!p.satOut && (
                <div className="mt-0.5 truncate text-center font-mono text-[9.5px] text-cream-dim/50">
                  roll {money(p.bankroll)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* footer strip */}
      <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-cream-dim/60">
        <span>
          {active.length} seated · stakes feed · <span className="text-cream-dim">exact pot {moneyExact(table.pot)}</span>
        </span>
        <span>table {table.tableId.slice(0, 8)}</span>
      </div>
    </div>
  );
}
