"use client";

import { formatDistanceToNow } from "date-fns";
import { MessageCircle, MessageSquarePlus, Plus, Trash2 } from "lucide-react";
import { BarLoader } from "react-spinners";
import { api } from "@/convex/_generated/api";
import { useConvexMutation, useConvexQuery } from "@/hooks/use-convex-query";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

export function ThreadList({ onSelectThread, onNewThread }) {
  const { data: threads, isLoading } = useConvexQuery(
    api.chat.getUserThreads,
    {}
  );
  const deleteThread = useConvexMutation(api.chat.deleteThread);

  const handleDelete = async (event, threadId) => {
    event.stopPropagation();

    const confirmed = window.confirm(
      "Delete this chat thread? This cannot be undone."
    );
    if (!confirmed) return;

    try {
      await deleteThread.mutate({ threadId });
      toast.success("Chat deleted");
    } catch (error) {
      toast.error("Failed to delete chat: " + error.message);
    }
  };

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <BarLoader width="100%" color="#36d7b7" />
      </div>
    );
  }

  if (!threads?.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <MessageCircle className="h-6 w-6 text-primary" />
        </div>
        <h3 className="font-semibold">No conversations yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Start one and ask Splitr AI about your expenses, balances, or groups.
        </p>
        <Button onClick={onNewThread} className="mt-5">
          <MessageSquarePlus className="h-4 w-4" />
          Start one
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-4 py-3">
        <Button onClick={onNewThread} className="w-full">
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-4">
          {threads.map((thread) => (
            <button
              key={thread._id}
              type="button"
              onClick={() => onSelectThread(thread._id)}
              className="group flex w-full items-start justify-between gap-3 rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:bg-muted/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{thread.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(thread.lastMessageAt), {
                    addSuffix: true,
                  })}
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground opacity-100 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
                onClick={(event) => handleDelete(event, thread._id)}
              >
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Delete chat</span>
              </Button>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
