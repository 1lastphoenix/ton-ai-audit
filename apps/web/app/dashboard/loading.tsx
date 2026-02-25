import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <main className="bg-background text-foreground relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(90%_70%_at_0%_0%,rgba(14,165,233,0.14),transparent_60%),radial-gradient(80%_65%_at_100%_10%,rgba(245,158,11,0.18),transparent_55%),radial-gradient(75%_65%_at_50%_100%,rgba(6,182,212,0.09),transparent_70%)]" />

      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-5 sm:gap-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm backdrop-blur sm:rounded-3xl sm:p-6">
          <div className="grid gap-4 sm:gap-6 lg:grid-cols-[1fr_auto] lg:items-start">
            <div className="space-y-3 sm:space-y-4">
              <Skeleton className="h-5 w-36 rounded-4xl" />
              <div className="space-y-2">
                <Skeleton className="h-8 w-60 sm:w-72" />
                <Skeleton className="h-4 w-full max-w-lg" />
              </div>
              <Skeleton className="h-3 w-44 sm:w-64" />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        </header>

        <section className="grid gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <article
              key={`kpi-skeleton-${index}`}
              className="bg-card/80 border-border/70 rounded-2xl border p-3.5 shadow-sm backdrop-blur sm:p-4"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-16" />
              <Skeleton className="mt-1 h-3 w-28" />
            </article>
          ))}
        </section>

        <section className="rounded-2xl border border-border/70 bg-card/75 p-3 shadow-sm backdrop-blur sm:rounded-3xl sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Skeleton className="h-8 w-full max-w-xl" />
            <div className="flex w-full items-center gap-2 lg:w-auto">
              <Skeleton className="h-8 flex-1 sm:w-44 sm:flex-none" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-6 w-24" />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => (
              <div
                key={`project-skeleton-${index}`}
                className="bg-background/60 rounded-2xl border border-border/60 p-3.5 sm:p-4"
              >
                <div className="grid gap-2.5">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-3 w-2/5" />
                  <Skeleton className="h-3 w-4/5" />
                  <div className="mt-1 flex gap-2">
                    <Skeleton className="h-6 w-16" />
                    <Skeleton className="h-6 w-16" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
