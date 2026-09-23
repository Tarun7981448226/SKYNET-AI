import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — SKYNET",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-16">
      <div className="glass-panel flex flex-col gap-5 p-8">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Privacy Policy</h1>
          <p className="mt-1 text-sm text-[var(--foreground)]/60">Last updated September 23, 2026</p>
        </div>

        <p className="text-sm leading-relaxed text-[var(--foreground)]/80">
          SKYNET is a personal job-search assistant built and used by a single person, Tarun
          Deep Reddy Bommaka Venkata. It is not a public product and does not collect data from
          or about anyone other than its owner.
        </p>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-[var(--foreground)]">What data SKYNET accesses</h2>
          <p className="text-sm leading-relaxed text-[var(--foreground)]/80">
            SKYNET reads job-alert emails from its owner&apos;s own Gmail account
            (read-only access) to find job postings, and uploads tailored resume files it
            generates to its owner&apos;s own Google Drive. It does not read, modify, or send
            any other email, and does not access any other person&apos;s Google account.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-[var(--foreground)]">How data is used</h2>
          <p className="text-sm leading-relaxed text-[var(--foreground)]/80">
            Job postings found this way are parsed, scored against the owner&apos;s resume, and
            used to generate tailored resume documents for the owner&apos;s own job search. Data
            is never sold, shared with third parties, or used for advertising.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Data storage</h2>
          <p className="text-sm leading-relaxed text-[var(--foreground)]/80">
            Parsed job data is stored in a private Postgres database the owner controls.
            Generated resume files are stored in the owner&apos;s own Google Drive. No data is
            shared with any other user or system.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-base font-semibold text-[var(--foreground)]">Contact</h2>
          <p className="text-sm leading-relaxed text-[var(--foreground)]/80">
            Questions about this policy can be sent to{" "}
            <a href="mailto:tarundeepreddybv@gmail.com" className="underline hover:text-[var(--foreground)]">
              tarundeepreddybv@gmail.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
