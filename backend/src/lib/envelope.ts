export function ok<T>(data: T, meta?: Record<string, unknown>) {
  return meta ? { data, meta } : { data };
}
