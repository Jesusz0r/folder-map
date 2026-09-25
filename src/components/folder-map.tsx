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
import type { MountedVolume, ScanErrorBody, ScanResult, TreeNode } from "@/lib/types";
import { treemapChildren } from "@/lib/visible-children";

type LoadState = "loading" | "ready" | "error";
type VolumeListResponse = { volumes?: MountedVolume[]; error?: string };

function volumeSelected(volumePath: string, currentPath: string): boolean {
  if (!currentPath) return false;
  if (volumePath === "/") {
    return currentPath === "/" || (currentPath.startsWith("/") && !currentPath.startsWith("/Volumes"));
  }
  return currentPath === volumePath || currentPath.startsWith(`${volumePath}/`);
}

function problemPaths(node: TreeNode, limit: number, found: string[] = []): string[] {
  if (found.length >= limit) return found;
  if (node.error && node.error !== "This folder was not fully scanned.") {
    found.push(node.path || node.name);
  }
  for (const child of node.children) {
    if (found.length >= limit) break;
    problemPaths(child, limit, found);
  }
  return found;
}

async function requestScan(path: string, signal: AbortSignal): Promise<ScanResult> {
  const query = `?path=${encodeURIComponent(path.trim())}`;
  const response = await fetch(`/api/scan${query}`, { signal, cache: "no-store" });
  let body: ScanResult | ScanErrorBody;
  try {
    body = (await response.json()) as ScanResult | ScanErrorBody;
  } catch {
    throw new Error("The scan failed before it could finish.");
  }
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
  volumes: initialVolumes,
  volumesError: initialVolumesError = null,
  initialPath,
}: {
  volumes: MountedVolume[];
  volumesError?: string | null;
  initialPath: string | null;
}) {
  const [volumes, setVolumes] = useState(initialVolumes);
  const [volumesError, setVolumesError] = useState<string | null>(initialVolumesError);
  const [status, setStatus] = useState<LoadState>(initialPath ? "loading" : "error");
  const [error, setError] = useState<string | null>(
    initialPath ? null : initialVolumesError ?? "No mounted volume was found.",
  );
  const [result, setResult] = useState<ScanResult | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [pendingPath, setPendingPath] = useState(initialPath ?? "");
  const [stack, setStack] = useState<TreeNode[]>([]);
  const [hover, setHover] = useState<TreeNode | null>(null);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [slow, setSlow] = useState(false);
  const requestId = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const startup = volumes.find((volume) => volume.startup) ?? null;

  const scan = useCallback(async (path: string) => {
    const target = path.trim();
    if (!target) {
      setStatus("error");
      setError("Choose a volume or paste a folder path.");
      return;
    }
    const id = requestId.current + 1;
    requestId.current = id;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => controller.abort("timeout"), 45_000);
    setSlow(false);
    setStatus("loading");
    setError(null);
    setPendingPath(target);
    try {
      const next = await requestScan(target, controller.signal);
      if (requestId.current !== id) return;
      setResult(next);
      setPathInput(next.root);
      setStack([next.tree]);
      setHover(null);
      setSelected(null);
      setStatus("ready");
    } catch (cause) {
      if (requestId.current !== id) return;
      const timedOut = controller.signal.reason === "timeout";
      if (cause instanceof DOMException && cause.name === "AbortError" && !timedOut) return;
      setStatus("error");
      setError(
        timedOut
          ? "The scan took too long and was stopped. Pick a smaller folder, or try the volume again."
          : cause instanceof Error
            ? cause.message
            : "The scan failed.",
      );
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const refreshVolumes = useCallback(async () => {
    try {
      const response = await fetch("/api/volumes", { cache: "no-store" });
      const body = (await response.json()) as VolumeListResponse;
      if (!response.ok || !Array.isArray(body.volumes)) {
        setVolumesError(body.error || "Mounted volumes could not be listed.");
        return;
      }
      setVolumes(body.volumes);
      setVolumesError(body.error ?? null);
    } catch {
      setVolumesError("Mounted volumes could not be listed.");
    }
  }, []);

  useEffect(() => {
    if (!initialPath) return;
    const timer = window.setTimeout(() => {
      void scan(initialPath);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialPath, scan]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => setSlow(true), 2_500);
    return () => window.clearTimeout(timer);
  }, [status, pendingPath]);

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
  const activePath = result?.root ?? pendingPath;
  const unreadPaths = useMemo(
    () => (result ? problemPaths(result.tree, 5) : []),
    [result],
  );
  const scanningName =
    volumes.find((volume) => volume.path === pendingPath)?.name ?? pendingPath ?? "this folder";

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

      <section className="flex flex-col gap-2" aria-label="Volumes on this Mac">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xs font-medium text-muted-foreground">Volumes on this Mac</h2>
          <Button type="button" variant="ghost" size="sm" onClick={() => void refreshVolumes()}>
            Refresh volumes
          </Button>
        </div>
        {volumesError ? (
          <Alert>
            <AlertCircle />
            <AlertTitle>Volume list is incomplete</AlertTitle>
            <AlertDescription>{volumesError}</AlertDescription>
          </Alert>
        ) : null}
        {volumes.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {volumes.map((volume) => {
              const active = volumeSelected(volume.path, activePath);
              return (
                <Button
                  key={volume.id}
                  type="button"
                  variant={active ? "default" : "outline"}
                  aria-pressed={active}
                  onClick={() => {
                    setPathInput(volume.path);
                    void scan(volume.path);
                  }}
                >
                  <HardDrive />
                  {volume.name}
                  {volume.startup ? <span className="font-normal opacity-80">Startup</span> : null}
                </Button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No mounted volumes were found.</p>
        )}
      </section>

      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void scan(pathInput);
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="scan-path" className="text-xs font-medium text-muted-foreground">
            Or scan another folder
          </label>
          <Input
            id="scan-path"
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder="/Users or another folder on this Mac"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-9 font-mono text-xs sm:text-sm"
          />
        </div>
        <Button type="submit" className="sm:mb-0">
          {scanning ? "Scanning…" : "Scan"}
        </Button>
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
            {startup ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setPathInput(startup.path);
                  void scan(startup.path);
                }}
              >
                Scan {startup.name}
              </Button>
            ) : null}
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
              <LoadingMap slow={slow} name={scanningName} />
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
                  Pick a volume above, or paste another folder path.
                </p>
              </div>
            ) : (
              <LoadingMap slow={slow} name={scanningName} />
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

      {scanning ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>{slow ? `Still reading ${scanningName}` : `Reading ${scanningName}`}</AlertTitle>
          <AlertDescription>
            {slow
              ? "A large volume can take about 20 seconds. If it hits that limit, the map shows a partial scan instead of failing."
              : "File names and sizes stay on this Mac. A large volume can take about 20 seconds."}
          </AlertDescription>
        </Alert>
      ) : null}

      {result?.truncated ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>This scan is partial</AlertTitle>
          <AlertDescription>
            The scan stopped after {formatCount(20_000)} entries or about 20 seconds. Folders past
            that limit are listed without a full size. The blocks already measured are the ones to
            trust. Paste a smaller folder above to read it completely.
          </AlertDescription>
        </Alert>
      ) : null}

      {result && result.unreadable > 0 ? (
        <Alert>
          <AlertCircle />
          <AlertTitle>Some items could not be read</AlertTitle>
          <AlertDescription>
            <p>
              {formatCount(result.unreadable)}{" "}
              {result.unreadable === 1 ? "item was" : "items were"} skipped because this Mac denied
              access or the size could not be read. That space is missing from the map.
            </p>
            {unreadPaths.length > 0 ? (
              <ul className="mt-2 font-mono text-[11px]">
                {unreadPaths.map((item) => (
                  <li key={item} className="truncate">
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
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

function LoadingMap({ slow, name }: { slow: boolean; name: string }) {
  return (
    <div className="flex aspect-[4/3] w-full flex-col gap-3 p-1">
      <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-2 gap-1.5">
        <Skeleton className="col-span-2 row-span-2 rounded-md bg-white/10" />
        <Skeleton className="rounded-md bg-white/10" />
        <Skeleton className="rounded-md bg-white/10" />
      </div>
      <p className="text-center text-sm text-muted-foreground">
        {slow ? `Still reading ${name}…` : `Reading ${name}…`}
      </p>
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
