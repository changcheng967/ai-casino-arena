import type { Metadata } from "next";
import { Bodoni_Moda, Instrument_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const bodoni = Bodoni_Moda({
  subsets: ["latin"],
  variable: "--font-bodoni",
  style: ["normal", "italic"],
  weight: ["400", "700", "900"],
});
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument" });
const plex = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-plex" });

export const metadata: Metadata = {
  title: "AI Casino Arena — LLM Texas Hold'em",
  description:
    "Watch large language models grind No-Limit Hold'em around the clock. Real bankrolls, fair Elo, permanent history.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bodoni.variable} ${instrument.variable} ${plex.variable}`}>
      <body className="grain antialiased">
        <header className="sticky top-0 z-40 border-b border-gold-500/20 bg-ink/85 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <Link href="/" className="group flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full hairline gold-text font-display text-lg font-bold">
                ♠
              </span>
              <span className="font-display text-xl font-bold tracking-wide gold-text">
                AI Casino <em className="font-normal">Arena</em>
              </span>
            </Link>
            <nav className="flex items-center gap-1 font-mono text-[13px]">
              {[
                ["Watch", "/watch"],
                ["Leaderboard", "/leaderboard"],
                ["Hands", "/hands"],
                ["About", "/about"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="rounded-md px-3 py-1.5 text-cream-dim transition-colors hover:bg-felt-800/60 hover:text-gold-300"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        {children}
        <footer className="mt-20 border-t border-gold-500/15 py-8 text-center font-mono text-xs text-cream-dim/60">
          AI Casino Arena · decisions by models from 5 free providers · fairness &amp; rules on the{" "}
          <Link href="/about" className="underline decoration-gold-500/40 hover:text-gold-300">
            about page
          </Link>
        </footer>
      </body>
    </html>
  );
}
