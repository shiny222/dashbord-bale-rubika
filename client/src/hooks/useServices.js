import { api } from '../api/client.js';
import { usePoll } from './usePoll.js';

export function useServices() {
  return usePoll(() => api('/services'), 5000, true);
}

export function useTelegramApiHealth() {
  return usePoll(() => api('/telegram-api/health'), 5000, true);
}
