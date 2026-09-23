import Link from "next/link";
import { getTransferView } from "@/lib/transfers";
import { isUuid } from "@/lib/http";
import TransferViewClient from "../transfer-view";

export const dynamic = "force-dynamic";

export default async function TransferPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;

  const invalid = !isUuid(id) || !token;
  let result: Awaited<ReturnType<typeof getTransferView>> | null = null;
  let crashed = false;
  if (!invalid) {
    try {
      result = await getTransferView(id, token ?? null);
    } catch (error) {
      console.error("[transfer page] lookup failed", error);
      crashed = true;
    }
  }

  if (!result || !result.ok || crashed) {
    const failure = result && !result.ok ? result : null;
    const expired = failure?.status === 410;
    const notFound = !result || failure?.status === 404;
    const stillUploading = failure?.status === 409;
    const serverError = crashed || (failure?.status ?? 0) >= 500;

    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <div className="w-full max-w-md">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-2xl dark:bg-zinc-900">
            {expired ? "⏳" : stillUploading ? "📤" : serverError ? "⚠️" : "🚫"}
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">
            {expired
              ? "This transfer has expired"
              : stillUploading
                ? "Still uploading"
                : serverError
                  ? "Something went wrong"
                  : notFound
                    ? "Transfer not found"
                    : "Invalid access link"}
          </h1>
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {expired
              ? "Transfers are deleted automatically 30 minutes after they are created."
              : stillUploading
                ? "The sender is still uploading the files. Try again shortly."
                : serverError
                  ? "The transfer service had a problem loading this transfer. Try again in a moment."
                  : notFound
                    ? "This transfer doesn't exist or was already deleted."
                    : "The link is missing its access token. Ask the sender to re-share the PIN."}
          </p>
          <Link
            href="/receive"
            className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Try another PIN
          </Link>
        </div>
      </div>
    );
  }

  return <TransferViewClient view={result.view} />;
}
