"use client";

import { useAction } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Loader2, SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarLoader } from "react-spinners";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useConvexQuery } from "@/hooks/use-convex-query";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessage } from "./chat-message";

export function ChatThread({ threadId, onBack, onDeleteThread }) {
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const bottomRef = useRef(null);
  const sendMessage = useAction(api.agent.sendMessage);
  const { data: messages, isLoading: isMessagesLoading } = useConvexQuery(
    api.chat.getThreadMessages,
    { threadId }
  );
  const { data: threads } = useConvexQuery(api.chat.getUserThreads, {});

  const thread = useMemo(
    () => threads?.find((item) => item._id === threadId),
    [threadId, threads]
  );
  const trimmedInput = input.trim();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages?.length, isSending]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!trimmedInput || isSending) return;

    const userMessage = trimmedInput;
    setInput("");
    setIsSending(true);

    try {
      const result = await sendMessage({
        threadId,
        userMessage,
      });

      if (!result.success) {
        toast.error(result.error || "Splitr AI could not respond.");
      }
    } catch (error) {
      toast.error("Failed to send message: " + error.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const handleDelete = () => {
    const confirmed = window.confirm(
      "Delete this chat thread? This cannot be undone."
    );
    if (confirmed) onDeleteThread();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back to chats</span>
        </Button>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">
            {thread?.title ?? "Chat"}
          </h3>
          {thread?.lastMessageAt && (
            <p className="text-xs text-muted-foreground">
              Updated{" "}
              {formatDistanceToNow(new Date(thread.lastMessageAt), {
                addSuffix: true,
              })}
            </p>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          className="text-muted-foreground hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
          <span className="sr-only">Delete chat</span>
        </Button>
      </div>

      {isMessagesLoading ? (
        <div className="px-4 py-6">
          <BarLoader width="100%" color="#36d7b7" />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-3 p-4">
            {!messages?.length && (
              <div className="py-10 text-center text-sm text-muted-foreground">
                Ask about balances, groups, recent expenses, or reminders.
              </div>
            )}

            {messages?.map((message) => (
              <ChatMessage key={message._id} message={message} />
            ))}

            {isSending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Splitr AI is thinking</span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}

      <form onSubmit={handleSubmit} className="border-t bg-background p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your expenses..."
            className="max-h-32 min-h-10 resize-none"
            disabled={isSending}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!trimmedInput || isSending}
            className="h-10 w-10 shrink-0"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
            <span className="sr-only">Send message</span>
          </Button>
        </div>
      </form>
    </div>
  );
}
