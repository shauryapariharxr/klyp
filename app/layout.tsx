import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Logo from "./components/Logo";
import GitHubButton from "./components/GitHubButton";

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
            <div className="flex items-center gap-2">
              {/* Two standalone buttons rather than one segmented pill — each
                  one is its own target now. */}
              <nav className="flex items-center gap-2 text-sm">
                <Link
                  href="/send"
                  className="glass rounded-full px-3.5 py-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white sm:px-4"
                >
                  Send
                </Link>
                <Link
                  href="/receive"
                  className="glass rounded-full px-3.5 py-1.5 text-slate-300 transition-colors hover:bg-white/10 hover:text-white sm:px-4"
                >
                  Receive
                </Link>
              </nav>
              <GitHubButton />
            </div>
          </div>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
        {/* Fully transparent footer — the starfield shows straight through. */}
        <footer className="py-5 text-center text-xs text-slate-500">
          Developed by{" "}
          <a
            href="https://github.com/shauryapariharxr"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-300 transition-colors hover:text-white"
          >
            shauryapariharxr
          </a>
          <span className="mx-2 text-slate-600">·</span>
          No accounts. Transfers self-destruct after 30 minutes.
        </footer>
      </body>
    </html>
  );
}
