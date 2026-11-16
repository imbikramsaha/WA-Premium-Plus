// Views and actions beyond chatting: automation, broadcasts, insights and settings.
// MainScreen shows these in its rail; the conversation adds their actions to its menus.

import { useMemo } from 'react';
import type { MainScreenExtras } from './components/MainScreen';

export function useExtras(): MainScreenExtras {
  return useMemo<MainScreenExtras>(() => ({}), []);
}
