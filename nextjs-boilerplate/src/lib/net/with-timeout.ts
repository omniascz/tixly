/** Kolo 11 — promise s časovým limitem: po `ms` se odmítne chybou "<co>: timeout <ms> ms" (síť nesmí viset). */
export function withTimeout<T>(p: Promise<T>, ms: number, what = 'operace'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what}: timeout ${ms} ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
