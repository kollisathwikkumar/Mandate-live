const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveApiUrl(path: string, configuredBase = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''): string {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('API requests must use a local API path');
  if (configuredBase === '') return path;

  let origin: URL;
  try {
    origin = new URL(configuredBase);
  } catch {
    throw new Error('VITE_API_BASE_URL must be a valid HTTPS origin');
  }
  const isLoopbackHttp = origin.protocol === 'http:' && LOCAL_HOSTS.has(origin.hostname);
  if (origin.protocol !== 'https:' && !isLoopbackHttp) throw new Error('VITE_API_BASE_URL must use an HTTPS origin');
  if (origin.username !== '' || origin.password !== '' || origin.pathname !== '/' || origin.search !== '' || origin.hash !== '') {
    throw new Error('VITE_API_BASE_URL must be an origin only, without credentials, path, query, or fragment');
  }
  return `${origin.origin}${path}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(resolveApiUrl(path), init);
}
