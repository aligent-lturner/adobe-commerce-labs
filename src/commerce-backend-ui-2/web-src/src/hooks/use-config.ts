import { useCallback } from 'react';
import actionUrls from '../config.json';

export function useConfig() {
  const getActionUrl = useCallback((action: string) => (actionUrls as Record<string, string>)[action], []);
  return { getActionUrl };
}
