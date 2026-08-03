// Diagnostics API helper — fetches the administrator diagnostics
// snapshot. Pure passthrough over the shared api() client.
import { api } from './client.js';

export function fetchDiagnostics({ signal } = {}) {
  return api('/diagnostics', { signal });
}
