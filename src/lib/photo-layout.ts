import type { PlacePhoto } from './types';

// Choose row breaks together, rather than leaving a stranded portrait or an
// oversized final row. Every photo keeps its original width / height ratio.
export function photoRows(photos: PlacePhoto[], width: number, gap = 10) {
  if (!photos.length || !Number.isFinite(width) || width <= 0) return [];
  const target = Math.min(260, Math.max(160, width * 0.55));
  const count = photos.length;
  const costs = Array<number>(count + 1).fill(Infinity);
  const ends = Array<number>(count).fill(0);
  costs[count] = 0;
  for (let start = count - 1; start >= 0; start--) {
    let ratio = 0;
    for (let end = start; end < count; end++) {
      ratio += photos[end].width / photos[end].height;
      const available = width - (end - start) * gap;
      if (available <= 0) break;
      const fitted = available / ratio;
      const last = end === count - 1;
      const height = last ? Math.min(target * 1.15, fitted) : fitted;
      const unused = last ? Math.max(0, (available - height * ratio) / width) : 0;
      const cost =
        ((height - target) / target) ** 2 * (end - start + 1) + unused ** 2 * 2 + costs[end + 1];
      if (cost < costs[start]) {
        costs[start] = cost;
        ends[start] = end + 1;
      }
      if (fitted < target * 0.45) break;
    }
  }
  const rows: { photos: PlacePhoto[]; height: number; width: number; ratio: number }[] = [];
  for (let start = 0; start < count;) {
    const end = ends[start];
    const items = photos.slice(start, end);
    const ratio = items.reduce((sum, photo) => sum + photo.width / photo.height, 0);
    const fitted = (width - (items.length - 1) * gap) / ratio;
    const height = end === count ? Math.min(target * 1.15, fitted) : fitted;
    rows.push({ photos: items, height, width: height * ratio + (items.length - 1) * gap, ratio });
    start = end;
  }
  return rows;
}
