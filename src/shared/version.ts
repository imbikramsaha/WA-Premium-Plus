// Comparing app versions like "0.5.0", "v0.5.1" or "1.0.0-beta.2".

function parts(version: string): { nums: number[]; pre: string } {
  const [main = '', pre = ''] = version.trim().replace(/^v/i, '').split('-', 2);
  return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
}

/** Negative if a < b, 0 if equal, positive if a > b. A pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length, 3); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}
