import { ChatPanel } from "@/components/cfo/chat-panel";

export default function ChatPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">AI CFO 챗봇</h1>
      <ChatPanel />
    </div>
  );
}
