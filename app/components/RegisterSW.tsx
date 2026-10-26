"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js once, after the window's load event. No UI — this exists
 * purely so the browser owns the install prompt (address-bar / browser menu);
 * the site deliberately adds no install button of its own.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failure must never break the app; ignore quietly.
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
