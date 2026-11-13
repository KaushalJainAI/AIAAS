/**
 * Fetches what the assistant sees in one conversation and hands it to the
 * props-only `ChatContextPanel`. Kept apart from the panel so the drawing
 * stays testable without the network, the rule every chat piece follows.
 *
 * Never cached across openings (`staleTime: 0`): the notes are rewritten
 * after every reply, and a stale view of the context is the thing this tab
 * exists to prevent.
 */
import { useQuery } from '@tanstack/react-query';

import { chatService } from '../../api/chat';
import ChatContextPanel from './ChatContextPanel';

export default function ChatContextView({ sessionId }: { sessionId: string }) {
  const query = useQuery({
    queryKey: ['chat-context', sessionId],
    queryFn: () => chatService.getContext(sessionId),
    staleTime: 0,
    retry: false,
  });

  return (
    <ChatContextPanel
      data={query.data ?? null}
      loading={query.isFetching}
      error={query.isError ? 'Could not read this conversation’s context.' : null}
      onRefresh={() => void query.refetch()}
    />
  );
}
