export function normalizeInternalRedirectPath(
  input: string | null | undefined,
  fallback = '/'
) {
  if (!input) {
    return fallback;
  }

  if (!input.startsWith('/') || input.startsWith('//')) {
    return fallback;
  }

  return input;
}
