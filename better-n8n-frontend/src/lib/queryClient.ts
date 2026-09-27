import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // Data is considered fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // Keep inactive data in cache for 10 minutes
      refetchOnWindowFocus: true, // Revalidate on focus for "Stale-While-Revalidate"
      retry: 1,
    },
  },
});
