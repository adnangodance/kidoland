export function isSeaGodanci(name?: string | null): boolean {
  if (!name) return false
  return /sea\s+godanci/i.test(name.trim())
}
