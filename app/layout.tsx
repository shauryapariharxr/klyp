import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Logo from "./components/Logo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face for headings — geometric, heavy, like the Klar wordmark.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
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

/**
 * Fixed deep-space backdrop: three parallax star layers drifting at different
 * speeds. The star fields (and the seamless wrap-around copies) live in
 * app/globals.css as box-shadow pixel maps.
 */
function SpaceBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="star-layer star-layer-1" />
      <div className="star-layer star-layer-2" />
      <div className="star-layer star-layer-3" />
    </div>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans text-slate-100">
        <SpaceBackdrop />
        <header className="sticky top-0 z-20">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3">
            {/* Logo reads as one word: the K mark flowing into "lyp". The mark's
                ink fills its box edge to edge, so size 15 == the 15px cap height
                of text-xl — it lands on the baseline as a letter would. */}
            <Link
              href="/"
              aria-label="Klyp"
              className="flex items-baseline gap-0.5"
            >
              <Logo size={15} />
              <span className="text-xl font-bold leading-none tracking-tight">
                lyp
              </span>
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
