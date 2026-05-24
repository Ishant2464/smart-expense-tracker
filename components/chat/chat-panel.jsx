"use client";

import { useState } from "react";
import { Bot, MessageCircle, MessageSquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useConvexMutation } from "@/hooks/use-convex-query";
import { Button } from "@/components/ui/button";
import { ChatThread } from "./chat-thread";
import { ThreadList } from "./thread-list";

export function ChatPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const createThread = useConvexMutation(api.chat.createThread);
  const deleteThread = useConvexMutation(api.chat.deleteThread);

  const handleNewThread = async () => {
    try {
      const threadId = await createThread.mutate({});
      setActiveThreadId(threadId);
      setIsOpen(true);
    } catch (error) {
      toast.error("Failed to create chat: " + error.message);
    }
  };

  const handleDeleteActiveThread = async () => {
    if (!activeThreadId) return;

    try {
      await deleteThread.mutate({ threadId: activeThreadId });
      setActiveThreadId(null);
      toast.success("Chat deleted");
    } catch (error) {
      toast.error("Failed to delete chat: " + error.message);
    }
  };

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close chat backdrop"
          className="fixed inset-0 z-[55] bg-black/30 sm:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 right-0 z-[60] flex w-full flex-col border-l bg-background shadow-2xl transition-transform duration-300 ease-in-out sm:w-[400px] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!isOpen}
      >
        {isOpen && (
          <>
            <div className="flex h-16 shrink-0 items-center gap-3 border-b px-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                <Bot className="h-5 w-5 text-primary" />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold">Splitr AI</h2>
                <p className="text-xs text-muted-foreground">
                  Ask, add, and settle smarter
                </p>
              </div>

              <Button variant="ghost" size="icon" onClick={handleNewThread}>
                <MessageSquarePlus className="h-4 w-4" />
                <span className="sr-only">New Chat</span>
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close chat</span>
              </Button>
            </div>

            <div className="min-h-0 flex-1">
              {activeThreadId ? (
                <ChatThread
                  threadId={activeThreadId}
                  onBack={() => setActiveThreadId(null)}
                  onDeleteThread={handleDeleteActiveThread}
                />
              ) : (
                <ThreadList
                  onSelectThread={setActiveThreadId}
                  onNewThread={handleNewThread}
                />
              )}
            </div>
          </>
        )}
      </aside>

      <Button
        type="button"
        size="icon"
        className="fixed bottom-5 right-5 z-[70] h-12 w-12 rounded-full shadow-lg transition-shadow hover:shadow-xl"
        onClick={() => setIsOpen((value) => !value)}
      >
        {isOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <MessageCircle className="h-5 w-5" />
        )}
        <span className="sr-only">{isOpen ? "Close chat" : "Open chat"}</span>
      </Button>
    </>
  );
}
