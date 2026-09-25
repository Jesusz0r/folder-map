"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowUp,
  File,
  Folder,
  HardDrive,
  Link2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { nodeKey, TreemapView } from "@/components/treemap-view";
import { formatBytes, formatCount, formatPercent } from "@/lib/format";
import type { ScanErrorBody, ScanResult, TreeNode } from "@/lib/types";
import { treemapChildren } from "@/lib/visible-children";

type LoadState = "loading" | "ready" | "error";

async function requestScan(path: string, signal: AbortSignal): Promise<ScanResult> {
  const query = path.trim() ? `?path=${encodeURIComponent(path.trim())}` : "";
  const response = await fetch(`/api/scan${query}`, { signal, cache: "no-store" });
  const body = (await response.json()) as ScanResult | ScanErrorBody;
  if (!response.ok || !("tree" in body)) {
    const message = "error" in body && body.error ? body.error : "The scan failed.";
    throw new Error(message);
  }
  return body;
}

function kindIcon(kind: TreeNode["kind"]) {
  if (kind === "dir") return Folder;
  if (kind === "symlink") return Link2;
  return File;
}

export function FolderMap({
  initial,
  initialError = null,
}: {
  initial: ScanResult | null;
  initialError?: string | null;
}) {
  const [status, setStatus] = useState<LoadState>(initial ? "ready" : "error");
  const [error, setError] = useState<string | null>(initial ? null : initialError);
  const [result, setResult] = useState<ScanResult | null>(initial);
  const [pathInput, setPathInput] = useState(initial?.root ?? "");
  const [stack, setStack] = useState<TreeNode[]>(initial ? [initial.tree] : []);
  const [hover, setHover] = useState<TreeNode | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const scan = useCallback(async (path: string) => {
    const id = requestId.current + 1;
    requestId.current = id;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setError(null);
    try {
      const next = await requestScan(path, controller.signal);
      if (requestId.current !== id) return;
      setResult(next);
      setPathInput(next.root);
      setStack([next.tree]);
      setHover(null);
      setSelected(null);
      setStatus("ready");
    } catch (cause) {
      if (requestId.current !== id) return;
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "The scan failed.");
    }
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const current = stack[stack.length - 1] ?? result?.tree ?? null;

  const goUp = useCallback(() => {
    setStack((crumbs) => (crumbs.length > 1 ? crumbs.slice(0, -1) : crumbs));
    setHover(null);
    setSelected(null);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Backspace" || event.key === "Escape") {
        event.preventDefault();
        goUp();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goUp]);

  const openNode = useCallback((node: TreeNode) => {
    if (node.kind === "dir") {
      setStack((crumbs) => [...crumbs, node]);
      setHover(null);
      setSelected(null);
      return;
    }
    setSelected(node);
    setHover(node);
  }, []);

  const blocks = useMemo(() => (current ? treemapChildren(current) : []), [current]);
  const focus = hover ?? selected ?? blocks[0] ?? null;
  const quiet = current?.children.filter((child) => child.size <= 0) ?? [];
  const scanning = status === "loading";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            aria-hidden
            className="size-9 rounded-lg bg-gradient-to-br from-primary to-mauve shadow-[0_0_24px_rgba(137,180,250,0.35)]"
          />
          <div>
            <h1 className="text-base font-semibold tracking-tight">Folder Map</h1>
            <p className="text-sm text-muted-foreground">
              Each block is a file or folder, sized by the space it uses.
            </p>
          </div>
        </div>
        <Badge variant="secondary">On this machine</Badge>
      </header>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void scan(pathInput);
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="scan-path" className="text-xs font-medium text-muted-foreground">
            Folder to scan
          </label>
          <Input
            id="scan-path"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder="Leave blank to scan the sample tree"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-9 font-mono text-xs sm:text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={scanning} className="flex-1 sm:flex-none">
            {scanning ? "Scanning…" : "Scan"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={scanning}
            onClick={() => {
              setPathInput("");
              void scan("");
            }}
          >
            Sample
          </Button>
        </div>
      </form>

      <p className="sr-only" aria-live="polite">
        {scanning
          ? "Scanning folder"
          : error
            ? error
            : result
              ? `Scanned ${result.root}, ${formatBytes(result.size)}`
              : ""}
      </p>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Couldn’t scan that folder</AlertTitle>
          <AlertDescription>
            <p>{error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                setPathInput("");
                void scan("");
              }}
            >
              Open the sample tree
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid flex-1 items-start gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
        <aside className="order-2 flex flex-col gap-4 lg:order-1">
          <Summary result={result} current={current} scanning={scanning && !result} />
          <LargestList
            nodes={current?.children ?? []}
            parentSize={current?.size ?? 0}
            disabled={!current}
            onOpen={openNode}
          />
        </aside>

        <section
          className="order-1 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:order-2"
          aria-busy={scanning}
        >
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={goUp}
              disabled={!current || stack.length <= 1}
              title="Up one folder (Backspace)"
            >
              <ArrowUp />
              Up
            </Button>
            <nav aria-label="Folder path" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              {stack.map((crumb, index) => {
                const last = index === stack.length - 1;
                return (
                  <span key={`${crumb.path}-${index}`} className="flex items-center gap-1">
                    {index > 0 ? <span className="text-muted-foreground">/</span> : null}
                    <button
                      type="button"
                      className="truncate font-mono text-xs text-muted-foreground hover:text-foreground disabled:text-foreground"
                      disabled={last}
                      onClick={() => {
                        setStack(stack.slice(0, index + 1));
                        setHover(null);
                        setSelected(null);
                      }}
                    >
                      {crumb.name}
                    </button>
                  </span>
                );
              })}
            </nav>
          </div>

          <div className="bg-[#1e1e2e] p-2">
            {scanning && !result ? (
              <LoadingMap />
            ) : current && blocks.length > 0 ? (
              <TreemapView
                nodes={blocks}
                parentSize={current.size}
                activeKey={hover || selected ? nodeKey(hover ?? selected!) : null}
                onOpen={openNode}
                onHover={setHover}
              />
            ) : current ? (
              <EmptyFolder node={current} canGoUp={stack.length > 1} onUp={goUp} />
            ) : error ? (
              <div className="flex aspect-[4/3] w-full flex-col items-center justify-center px-6 text-center">
                <p className="font-medium">The map is empty until a scan succeeds.</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Check the path, or open the sample tree.
                </p>
              </div>
            ) : (
              <LoadingMap />
            )}
          </div>

          <div className="flex min-h-14 flex-col justify-center gap-1 border-t border-border px-3 py-2">
            {focus && current ? (
              <>
                <p className="truncate text-sm font-medium">
                  {focus.name}
                  <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                    {formatBytes(focus.size)} · {formatPercent(focus.size, current.size)} of this folder
                    {result ? ` · ${formatPercent(focus.size, result.size)} of scan` : ""}
                  </span>
                </p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {focus.path || "Smaller items grouped from this folder"}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Hover a block for its size and path. Click a folder to open it.
              </p>
            )}
          </div>

          <footer className="flex flex-col gap-1 border-t border-border px-3 py-2 font-mono text-[11px] text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4">
            <span className="text-foreground">{result?.name ?? "—"}</span>
            <span>
              {current
                ? `${formatBytes(current.size)} in this folder · ${formatCount(current.fileCount)} files`
                : "Waiting for a scan"}
            </span>
            <span>
              {result?.volume
                ? `${formatBytes(result.volume.totalBytes - result.volume.freeBytes)} used of ${formatBytes(result.volume.totalBytes)} · ${formatPercent(result.volume.freeBytes, result.volume.totalBytes)} free`
                : "Volume size unavailable"}
            </span>
          </footer>
        </section>
      </div>

      {result?.truncated ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>This scan is partial</AlertTitle>
          <AlertDescription>
            The scan stopped after {formatCount(20_000)} entries or about 20 seconds. Sizes below
            that line are missing, so the biggest blocks are still the ones to trust.
          </AlertDescription>
        </Alert>
      ) : null}

      {quiet.length > 0 && current && blocks.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {quiet.length === 1 ? "1 item takes" : `${quiet.length} items take`} no space and{" "}
          {quiet.length === 1 ? "is" : "are"} hidden on the map:{" "}
          {quiet
            .slice(0, 6)
            .map((node) => node.name)
            .join(", ")}
          {quiet.length > 6 ? "…" : ""}
        </p>
      ) : null}
    </div>
  );
}

function LoadingMap() {
  return (
    <div className="flex aspect-[4/3] w-full flex-col gap-3 p-1">
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-1.5">
        <Skeleton className="col-span-2 row-span-2 rounded-md bg-white/10" />
        <Skeleton className="rounded-md bg-white/10" />
        <Skeleton className="rounded-md bg-white/10" />
      </div>
      <p className="text-center text-sm text-muted-foreground">Reading file sizes…</p>
    </div>
  );
}

function EmptyFolder({
  node,
  canGoUp,
  onUp,
}: {
  node: TreeNode;
  canGoUp: boolean;
  onUp: () => void;
}) {
  const emptyItems = node.children.filter((child) => child.size <= 0);
  return (
    <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Folder className="size-8 text-muted-foreground" />
      <div className="max-w-sm">
        <p className="font-medium">Nothing in {node.name} has a size</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {node.error
            ? node.error
            : emptyItems.length > 0
              ? "The folder has items, and each one is empty or a shortcut."
              : "This folder has no files or subfolders."}
        </p>
      </div>
      {emptyItems.length > 0 ? (
        <ul className="max-w-sm text-left font-mono text-xs text-muted-foreground">
          {emptyItems.slice(0, 8).map((child) => (
            <li key={nodeKey(child)} className="truncate">
              {child.name}
              {child.kind === "symlink" ? " → shortcut" : ""}
            </li>
          ))}
        </ul>
      ) : null}
      {canGoUp ? (
        <Button type="button" variant="outline" size="sm" onClick={onUp}>
          <ArrowUp />
          Up one folder
        </Button>
      ) : null}
    </div>
  );
}

function Summary({
  result,
  current,
  scanning,
}: {
  result: ScanResult | null;
  current: TreeNode | null;
  scanning: boolean;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <HardDrive className="size-4 text-primary" />
          Explorer
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {scanning || !result || !current ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <>
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={result.root}>
              {result.root}
            </p>
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="This folder" value={formatBytes(current.size)} />
              <Stat label="Whole scan" value={formatBytes(result.size)} />
              <Stat label="Files" value={formatCount(current.fileCount)} />
              <Stat label="Folders" value={formatCount(current.dirCount)} />
            </dl>
            <Separator />
            <p className="text-xs text-muted-foreground">
              {result.volume
                ? `${formatPercent(result.volume.freeBytes, result.volume.totalBytes)} of this volume is free (${formatBytes(result.volume.freeBytes)} of ${formatBytes(result.volume.totalBytes)}).`
                : "Free space for this volume isn’t available."}
            </p>
            {result.unreadable > 0 ? (
              <p className="text-xs text-peach">
                {result.unreadable} {result.unreadable === 1 ? "item" : "items"} could not be read.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sizes are apparent lengths, the byte count the filesystem reports.
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">Scanned in {result.elapsedMs} ms</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

function LargestList({
  nodes,
  parentSize,
  disabled,
  onOpen,
}: {
  nodes: TreeNode[];
  parentSize: number;
  disabled: boolean;
  onOpen: (node: TreeNode) => void;
}) {
  const ranked = nodes.filter((node) => node.size > 0).slice(0, 8);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Largest here</CardTitle>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : ranked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sized items in this folder.</p>
        ) : (
          <ul className="flex flex-col">
            {ranked.map((node) => {
              const Icon = kindIcon(node.kind);
              return (
                <li key={nodeKey(node)}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-muted"
                    onClick={() => onOpen(node)}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{node.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                      {formatBytes(node.size)}
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-[11px] text-primary">
                      {formatPercent(node.size, parentSize)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
