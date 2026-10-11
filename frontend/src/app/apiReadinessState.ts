export type ApiReadinessState = 'checking' | 'ready' | 'unavailable';

export function apiReadinessState(loading: boolean, error: string | null, hasProfile: boolean): ApiReadinessState {
  if (loading) return 'checking';
  return error === null && hasProfile ? 'ready' : 'unavailable';
}
