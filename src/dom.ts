export function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`The page is missing #${id}.`);
  return element as T;
}

export function message(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}
