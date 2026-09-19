import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-2xl font-semibold">Not found</h1>
        <Link href="/" className="text-sm text-accent hover:underline">
          ← Back to projects
        </Link>
      </div>
    </main>
  );
}