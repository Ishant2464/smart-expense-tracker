"use client";

import { format } from "date-fns";
import {
  BarChart3,
  CheckCircle2,
  Loader2,
  Mail,
  PlusCircle,
  Search,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TOOL_LABELS = {
  getMyBalances: {
    call: "Checking your balances",
    result: "Balance loaded",
    Icon: Wallet,
  },
  getMyMonthlySpending: {
    call: "Loading monthly spending",
    result: "Spending data ready",
    Icon: BarChart3,
  },
  getMyGroups: {
    call: "Loading your groups",
    result: "Groups loaded",
    Icon: Users,
  },
  getGroupDetails: {
    call: "Looking up group details",
    result: "Group details ready",
    Icon: Search,
  },
  getRecentExpenses: {
    call: "Fetching recent expenses",
    result: "Expenses loaded",
    Icon: Search,
  },
  getExpensesWithPerson: {
    call: "Looking up expenses",
    result: "Expenses loaded",
    Icon: Search,
  },
  addExpense: {
    call: "Adding expense",
    result: "Expense checked",
    Icon: PlusCircle,
  },
  sendPaymentReminder: {
    call: "Sending reminder",
    result: "Reminder processed",
    Icon: Mail,
  },
};

export function ChatMessage({ message }) {
  if (message.role === "tool_call") {
    return <ToolStatus message={message} type="call" />;
  }

  if (message.role === "tool_result") {
    return <ToolStatus message={message} type="result" />;
  }

  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "border bg-card text-card-foreground"
        )}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {isUser ? message.content : renderAssistantContent(message.content)}
        </div>
        <div
          className={cn(
            "mt-1 text-[10px]",
            isUser ? "text-primary-foreground/70" : "text-muted-foreground"
          )}
        >
          {format(new Date(message.timestamp), "p")}
        </div>
      </div>
    </div>
  );
}

function ToolStatus({ message, type }) {
  const labels = TOOL_LABELS[message.toolName] ?? {
    call: `Running ${message.toolName ?? "tool"}`,
    result: "Tool finished",
    Icon: Wrench,
  };
  const Icon = type === "call" ? Loader2 : CheckCircle2;
  const ToolIcon = labels.Icon;

  return (
    <div className="flex justify-center">
      <div className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-muted-foreground">
        {type === "call" ? (
          <Icon className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Icon className="h-3.5 w-3.5 text-green-600" />
        )}
        <ToolIcon className="h-3.5 w-3.5" />
        <span>{type === "call" ? labels.call : labels.result}</span>
        <span className="text-[10px]">
          {format(new Date(message.timestamp), "p")}
        </span>
      </div>
    </div>
  );
}

function renderAssistantContent(content) {
  return String(content ?? "")
    .split("\n")
    .map((line, lineIndex) => (
      <span key={`${line}-${lineIndex}`}>
        {renderBoldSegments(line)}
        {lineIndex < String(content ?? "").split("\n").length - 1 && <br />}
      </span>
    ));
}

function renderBoldSegments(line) {
  const segments = line.split(/(\*\*[^*]+\*\*)/g);

  return segments.map((segment, index) => {
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return (
        <strong key={`${segment}-${index}`} className="font-semibold">
          {segment.slice(2, -2)}
        </strong>
      );
    }

    return <span key={`${segment}-${index}`}>{segment}</span>;
  });
}
