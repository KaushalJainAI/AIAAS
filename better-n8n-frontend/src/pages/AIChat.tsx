import StandaloneChat from '../components/chat/StandaloneChat';

export default function AIChat() {
  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden relative">

      <div className="flex-1 overflow-hidden relative">
        <StandaloneChat />
      </div>
    </div>
  );
}
