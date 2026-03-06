import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-900 text-slate-100">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-slate-400">The page you’re looking for doesn’t exist.</p>
      <Link
        href="/"
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400"
      >
        Go to Swarm Frontend
      </Link>
    </div>
  );
}
