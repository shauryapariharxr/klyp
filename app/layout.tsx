import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Logo from "./components/Logo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Klyp — share files & text with a 4-digit PIN",
    template: "%s · Klyp",
  },
  description:
    "Anonymous, login-free file and text sharing. Upload, get a 4-digit PIN, share it — the receiver enters the PIN to download. Everything expires in 30 minutes.",
};

/** Fixed deep-space backdrop: nebula glows + three drifting star layers. */
function SpaceBackdrop() {
  // Deterministic star positions → same sky on server and client (no hydration
  // mismatch), dense enough that the 2000px loop keeps the sky evenly filled.
  function stars(count: number, size: number) {
    let shadows = "";
    for (let i = 0; i < count; i++) {
      const x = (i * 977) % 2000;
      const y = (i * 613) % 1200;
      const dim = 0.35 + (((i * 271) % 100) / 100) * 0.65;
      const color =
        i % 13 === 0
          ? `rgba(165,180,252,${dim})`
          : i % 7 === 0
            ? `rgba(103,232,249,${dim})`
            : `rgba(255,255,255,${dim})`;
      shadows += `${x}px ${y}px 0 ${size}px ${color}`;
      if (i < count - 1) shadows += ", ";
    }
    return shadows;
  }

  const layers = [
    { cls: "star-layer-1", size: 0.7, count: 220 },
    { cls: "star-layer-2", size: 1, count: 120 },
    { cls: "star-layer-3", size: 1.4, count: 60 },
  ];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div
        className="nebula left-[8%] top-[-12%] h-[26rem] w-[26rem] bg-indigo-500/25"
      />
      <div
        className="nebula right-[-6%] top-[28%] h-[30rem] w-[30rem] bg-cyan-400/15"
      />
      <div
        className="nebula bottom-[-14%] left-[30%] h-[28rem] w-[28rem] bg-violet-500/20"
      />
      {layers.map((layer) => (
        <div
          key={layer.cls}
          className={`star-layer ${layer.cls}`}
          style={{
            width: layer.size * 2,
            height: layer.size * 2,
            boxShadow: stars(layer.count, layer.size / 2),
          }}
        />
      ))}
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-slate-100">
        <SpaceBackdrop />
        <header className="glass sticky top-0 z-20 border-x-0 border-t-0">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-lg font-semibold tracking-tight"
            >
              <Logo size={26} />
              <span>Klyp</span>
            </Link>
            <nav className="glass flex items-center gap-1 rounded-full p-1 text-sm">
              <Link
                href="/send"
                className="rounded-full px-4 py-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                Send
              </Link>
              <Link
                href="/receive"
                className="rounded-full px-4 py-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                Receive
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
        <footer className="glass border-x-0 border-b-0 py-4 text-center text-xs text-slate-400">
          No accounts. Transfers self-destruct after 30 minutes.
        </footer>
      </body>
    </html>
  );
}
