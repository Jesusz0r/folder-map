export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type RowItem = {
  index: number;
  area: number;
};

function worst(row: RowItem[], side: number): number {
  if (row.length === 0 || side <= 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  for (const item of row) {
    sum += item.area;
    if (item.area < min) min = item.area;
    if (item.area > max) max = item.area;
  }
  if (min <= 0 || sum <= 0) return Number.POSITIVE_INFINITY;
  const sum2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}

function placeRow(row: RowItem[], bounds: Rect, rects: Rect[]): Rect {
  const rowArea = row.reduce((sum, item) => sum + item.area, 0);
  const verticalStrip = bounds.w >= bounds.h;

  if (verticalStrip) {
    const rowWidth = bounds.h > 0 ? rowArea / bounds.h : 0;
    let y = bounds.y;
    for (const item of row) {
      const height = rowWidth > 0 ? item.area / rowWidth : 0;
      rects[item.index] = { x: bounds.x, y, w: rowWidth, h: height };
      y += height;
    }
    return {
      x: bounds.x + rowWidth,
      y: bounds.y,
      w: Math.max(0, bounds.w - rowWidth),
      h: bounds.h,
    };
  }

  const rowHeight = bounds.w > 0 ? rowArea / bounds.w : 0;
  let x = bounds.x;
  for (const item of row) {
    const width = rowHeight > 0 ? item.area / rowHeight : 0;
    rects[item.index] = { x, y: bounds.y, w: width, h: rowHeight };
    x += width;
  }
  return {
    x: bounds.x,
    y: bounds.y + rowHeight,
    w: bounds.w,
    h: Math.max(0, bounds.h - rowHeight),
  };
}

/** Squarified treemap. `sizes` are non-negative weights. Zero-size entries get an empty rect. */
export function squarify(sizes: number[], bounds: Rect): Rect[] {
  const rects = sizes.map(() => ({ x: bounds.x, y: bounds.y, w: 0, h: 0 }));
  if (bounds.w <= 0 || bounds.h <= 0) return rects;

  const total = sizes.reduce((sum, size) => sum + (size > 0 ? size : 0), 0);
  if (total <= 0) return rects;

  const area = bounds.w * bounds.h;
  const items: RowItem[] = [];
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    if (size > 0) items.push({ index, area: (size / total) * area });
  }

  let remaining = { ...bounds };
  let row: RowItem[] = [];

  for (const item of items) {
    const side = Math.min(remaining.w, remaining.h);
    if (row.length === 0 || worst(row.concat(item), side) <= worst(row, side)) {
      row.push(item);
      continue;
    }
    remaining = placeRow(row, remaining, rects);
    row = [item];
  }

  if (row.length > 0) placeRow(row, remaining, rects);
  return rects;
}
