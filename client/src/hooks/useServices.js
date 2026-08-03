import { api } from '../api/client.js';
import { usePoll } from './usePoll.js';

export function useServices() {
  return usePoll(({ signal }) => api('/services', { signal }), 5000, true);
}

export function useTelegramApiHealth() {
  return usePoll(({ signal }) => api('/telegram-api/health', { signal }), 5000, true);
}
