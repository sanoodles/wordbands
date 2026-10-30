"use client";

import { useSyncExternalStore } from "react";
import Workspace from "@/components/Workspace";

const nothingToWatch = () => () => {};

// The Workspace reads the browser's storage and language, so the server renders a sized
// placeholder and the first client render swaps it in. It is a static import, because
// next/dynamic with ssr:false leaves the chunk out of the HTML, and the browser would ask
// for it only after hydration.
export default function WorkspaceClient({ country }: { country: string | null }) {
  const inBrowser = useSyncExternalStore(
    nothingToWatch,
    () => true,
    () => false,
  );
  return inBrowser ? <Workspace country={country} /> : <div className="tw-min-h-[560px]" aria-hidden />;
}
