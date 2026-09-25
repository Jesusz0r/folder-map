import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="h-9 w-full" />
      <div className="grid gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
        <div className="order-2 flex flex-col gap-4 lg:order-1">
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
        <div className="order-1 flex aspect-[4/3] w-full flex-col gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10 lg:order-2">
          <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-1.5">
            <Skeleton className="col-span-2 row-span-2 rounded-md" />
            <Skeleton className="rounded-md" />
            <Skeleton className="rounded-md" />
          </div>
          <p className="text-center text-sm text-muted-foreground">Reading file sizes…</p>
        </div>
      </div>
    </div>
  );
}
