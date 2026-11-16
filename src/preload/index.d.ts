import type { WappApi } from '../shared/types';

declare global {
  interface Window {
    wapp: WappApi;
  }
}
