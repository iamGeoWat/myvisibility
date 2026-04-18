import Link from "next/link";
import { SignInButton, SignedIn, SignedOut } from "@clerk/nextjs";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">MyVisibility</h1>
      <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-400">
        Find where your name, phone, email and address are exposed on the
        public web. Get direct opt-out links and copy-paste takedown emails in
        the right legal framework.
      </p>
      <div className="mt-10 flex gap-3">
        <SignedOut>
          <SignInButton mode="modal">
            <button className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900">
              Start free scan
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <Link
            href="/dashboard"
            className="rounded-md bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Go to dashboard
          </Link>
        </SignedIn>
      </div>
    </main>
  );
}
