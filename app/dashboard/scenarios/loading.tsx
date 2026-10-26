export default function ScenariosLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8" aria-busy="true" aria-label="Loading decision test">
      <div className="h-4 w-28 animate-pulse rounded bg-line" />
      <div className="mt-5 h-8 w-48 animate-pulse rounded bg-line" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-line" />
      <div className="mt-8 rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="h-20 animate-pulse rounded-md bg-bg" />
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-16 animate-pulse rounded-md bg-bg" />
          <div className="h-16 animate-pulse rounded-md bg-bg" />
        </div>
      </div>
    </div>
  );
}
