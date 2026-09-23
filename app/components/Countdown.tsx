"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRemaining } from "@/lib/format";

export default function Countdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const [remaining, setRemaining] = useState(() => formatRemaining(expiresAt));

  useEffect(() => {
    const tick = () => {
      const next = formatRemaining(expiresAt);
      setRemaining(next);
      if (next === "expired") {
        router.replace("/expired");
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, router]);

  return (
    <span className="font-mono tabular-nums" aria-live="off">
      {remaining === "expired" ? "0:00" : remaining}
    </span>
  );
}
