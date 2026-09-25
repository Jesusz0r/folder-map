"use client";

import { useMemo } from "react";
import { formatBytes, formatPercent } from "@/lib/format";
import type { TreeNode } from "@/lib/types";
import { squarify } from "@/lib/squarify";

const PALETTE = [
  ["#3B4B7A", "#2A3560"],
  ["#2A5A5A", "#1E4040"],
  ["#4A3060", "#2E1E40"],
  ["#5A3A2A", "#3D2518"],
  ["#4A2A3A", "#2E1825"],
  ["#2A4A3A", "#1A3028"],
  ["#3A3A50", "#252535"],
  ["#3D4E6A", "#28344A"],
  ["#4E3D55", "#322838"],
  ["#3E4A3A", "#283228"],
] as const;

/** Fixed layout box. Percent positions match this aspect ratio (4 / 3). */
const VIEW_W = 1000;
const VIEW_H = 750;

type TreemapViewProps = {
  nodes: TreeNode[];
  parentSize: number;
  activeKey: string | null;
  onOpen: (node: TreeNode) => void;
  onHover: (node: TreeNode | null) => void;
};

export function nodeKey(node: TreeNode): string {
  return node.path || node.name;
}

export function TreemapView({ nodes, parentSize, activeKey, onOpen, onHover }: TreemapViewProps) {
  const sizes = useMemo(() => nodes.map((node) => node.size), [nodes]);
  const rects = useMemo(
    () => squarify(sizes, { x: 0, y: 0, w: VIEW_W, h: VIEW_H }),
    [sizes],
  );

  return (
    <div className="relative aspect-[4/3] w-full">
      {rects.map((rect, index) => {
        const node = nodes[index];
        const left = (rect.x / VIEW_W) * 100;
        const top = (rect.y / VIEW_H) * 100;
        const width = (rect.w / VIEW_W) * 100;
        const height = (rect.h / VIEW_H) * 100;
        const gap = width > 4 && height > 4 ? 0.45 : 0.15;
        const boxW = Math.max(0, width - gap);
        const boxH = Math.max(0, height - gap);
        if (boxW < 0.4 || boxH < 0.4) return null;
        const [from, to] = PALETTE[index % PALETTE.length];
        const showName = boxW > 8 && boxH > 6;
        const showSize = boxW > 8 && boxH > 12;
        const key = nodeKey(node);
        const selected = activeKey === key;

        return (
          <button
            key={key}
            type="button"
            className="absolute overflow-hidden rounded-md text-left outline-none transition-[filter,box-shadow] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-white/80"
            style={{
              left: `${left + gap / 2}%`,
              top: `${top + gap / 2}%`,
              width: `${boxW}%`,
              height: `${boxH}%`,
              background: `linear-gradient(135deg, ${from}, ${to})`,
              boxShadow: selected ? "inset 0 0 0 2px rgba(255,255,255,0.85)" : undefined,
            }}
            aria-label={`${node.name}, ${formatBytes(node.size)}, ${formatPercent(node.size, parentSize)} of this folder`}
            onClick={() => onOpen(node)}
            onPointerEnter={(event) => {
              if (event.pointerType === "touch") return;
              onHover(node);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "touch") return;
              onHover(null);
            }}
            onFocus={() => onHover(node)}
            onBlur={() => onHover(null)}
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/10 via-transparent to-black/50" />
            {showName ? (
              <span className="relative z-10 flex h-full flex-col justify-end p-2">
                <span className="truncate text-[11px] font-semibold text-white sm:text-xs">
                  {node.name}
                </span>
                {showSize ? (
                  <span className="truncate font-mono text-[10px] text-white/75">
                    {formatBytes(node.size)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
