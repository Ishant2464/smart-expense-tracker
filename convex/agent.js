"use node";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { TOOL_DEFINITIONS, executeToolCall } from "./agentTools.js";

const MAX_TOOL_CALLS = 5;
const HISTORY_LIMIT = 20;

export const sendMessage = action({
  args: {
    threadId: v.id("chatThreads"),
    userMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const userMessage = args.userMessage.trim();

    if (!userMessage) {
      return {
        success: false,
        error: "Message cannot be empty.",
      };
    }

    const currentUser = await ctx.runQuery(internal.users.getCurrentUser);
    await ctx.runQuery(internal.chat.getThreadForAgent, {
      threadId: args.threadId,
    });

    await ctx.runMutation(api.chat.addMessage, {
      threadId: args.threadId,
      role: "user",
      content: userMessage,
    });

    const toolCalls = [];

    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
      const messages = await getRecentMessages(ctx, args.threadId);
      const prompt = buildAgentPrompt({
        currentUser,
        messages,
      });
      const modelText = await generateGeminiText(prompt);
      const toolCall = parseToolCall(modelText);

      if (!toolCall) {
        const assistantMessage = cleanAssistantText(modelText);

        await ctx.runMutation(api.chat.addMessage, {
          threadId: args.threadId,
          role: "assistant",
          content: assistantMessage,
        });

        return {
          success: true,
          assistantMessage,
          toolCalls,
        };
      }

      const toolArgs = normalizeToolArguments(toolCall.arguments);

      await ctx.runMutation(api.chat.addMessage, {
        threadId: args.threadId,
        role: "tool_call",
        content: `Calling ${toolCall.name}`,
        toolName: toolCall.name,
        toolArgs: safeJsonStringify(toolArgs),
      });

      const result = await executeToolCall(ctx, toolCall.name, toolArgs);
      const resultSummary = summarizeToolResult(toolCall.name, result);

      await ctx.runMutation(api.chat.addMessage, {
        threadId: args.threadId,
        role: "tool_result",
        content: resultSummary,
        toolName: toolCall.name,
        toolResult: safeJsonStringify(result),
      });

      toolCalls.push({
        name: toolCall.name,
        args: toolArgs,
        result,
      });
    }

    const assistantMessage =
      "I hit my tool limit for this request. I completed what I could, but please ask me to continue if you want me to take another step.";

    await ctx.runMutation(api.chat.addMessage, {
      threadId: args.threadId,
      role: "assistant",
      content: assistantMessage,
    });

    return {
      success: true,
      assistantMessage,
      toolCalls,
    };
  },
});

async function getRecentMessages(ctx, threadId) {
  const messages = await ctx.runQuery(api.chat.getThreadMessages, {
    threadId,
  });

  return messages.slice(-HISTORY_LIMIT);
}

function buildAgentPrompt({ currentUser, messages }) {
  return `
You are Splitr's assistant for shared expenses. You answer questions and may use tools against the user's real Splitr data.

Current user:
- name: ${currentUser.name}
- userId: ${currentUser._id}
- email: ${currentUser.email}

Current date/time:
${new Date().toISOString()}

Available tools:
${TOOL_DEFINITIONS.map(
  (tool) =>
    `- ${tool.name}: ${tool.description}\n  Parameters: ${tool.parameters}`
).join("\n")}

Tool rules:
- To call a tool, respond with strict JSON only:
  { "tool_call": { "name": "toolName", "arguments": { } } }
- To respond to the user, write plain text only. Do not wrap final answers in JSON.
- You can call ONE tool per turn. After a tool result appears in the conversation, you may call another tool or answer.
- Use tools for real balances, expenses, groups, reminders, and expense creation.
- For adding an expense, use addExpense with a natural language description. If creation requires confirmation, explain that clearly.
- For multi-step requests, call tools one at a time until you have enough information.
- Be concise and helpful. Format currency as Rs. amounts. Use ${currentUser.name}'s name naturally.
- Never claim an expense, settlement, email, or reminder was completed unless the tool result says it succeeded.

Conversation:
${formatMessagesForPrompt(messages)}
  `.trim();
}

function formatMessagesForPrompt(messages) {
  return messages
    .map((message) => {
      if (message.role === "tool_call") {
        return `TOOL_CALL ${message.toolName}: ${
          message.toolArgs ?? message.content
        }`;
      }

      if (message.role === "tool_result") {
        return `TOOL_RESULT ${message.toolName}: ${message.content}`;
      }

      return `${message.role.toUpperCase()}: ${message.content}`;
    })
    .join("\n");
}

async function generateGeminiText(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const result = await model.generateContent(prompt);

  if (typeof result.response.text === "function") {
    return result.response.text();
  }

  return (
    result.response.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("") ?? ""
  );
}

function parseToolCall(modelText) {
  const jsonText = extractJsonObject(stripMarkdownFences(modelText));
  if (!jsonText) return null;

  try {
    const parsed = JSON.parse(jsonText);
    const toolCall = parsed.tool_call;

    if (!toolCall || typeof toolCall.name !== "string") {
      return null;
    }

    return {
      name: toolCall.name,
      arguments: toolCall.arguments ?? {},
    };
  } catch {
    return null;
  }
}

function stripMarkdownFences(text) {
  const trimmed = String(text ?? "").trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function extractJsonObject(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function cleanAssistantText(text) {
  const cleaned = String(text ?? "").trim();
  return cleaned || "I could not generate a response. Please try again.";
}

function normalizeToolArguments(toolArgs) {
  if (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
    return {};
  }

  return toolArgs;
}

function summarizeToolResult(toolName, result) {
  if (!result?.success) {
    return `${toolName} failed: ${result?.error ?? "Unknown error"}`;
  }

  if (toolName === "getMyBalances") {
    return `Balance summary: you owe ${formatCurrency(
      result.data.youOwe
    )}, you are owed ${formatCurrency(
      result.data.youAreOwed
    )}, net balance ${formatCurrency(result.data.totalBalance)}.`;
  }

  if (toolName === "getMyMonthlySpending") {
    const total = result.data.reduce((sum, item) => sum + item.total, 0);
    return `Monthly spending loaded for ${result.data.length} months. Year total in returned months is ${formatCurrency(total)}.`;
  }

  if (toolName === "getMyGroups") {
    return `Found ${result.data.length} groups: ${result.data
      .map((group) => `${group.name} (${formatCurrency(group.balance)})`)
      .join(", ")}.`;
  }

  if (toolName === "getGroupDetails") {
    return `Group ${result.data.group.name}: ${result.data.members.length} members, ${result.data.recentExpenses.length} recent expenses, ${result.data.settlementCount} settlements.`;
  }

  if (toolName === "getRecentExpenses") {
    return `Found ${result.data.length} recent expenses.`;
  }

  if (toolName === "getExpensesWithPerson") {
    return `Balance with ${result.data.person.name}: ${formatCurrency(
      result.data.balance
    )}; ${result.data.recentExpenses.length} recent expenses returned.`;
  }

  if (toolName === "addExpense") {
    return result.data.created
      ? `Expense created successfully with id ${result.data.createdExpenseId}.`
      : `Expense was parsed but not created. It requires confirmation. Warnings: ${
          result.data.warnings?.join(" ") || "none"
        }`;
  }

  if (toolName === "sendPaymentReminder") {
    return `Payment reminder sent to ${result.data.personName} at ${result.data.sentTo} for ${formatCurrency(result.data.amount)}.`;
  }

  return `${toolName} succeeded.`;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: "Could not serialize value" });
  }
}

function formatCurrency(amount) {
  const number = Number(amount);
  const safeNumber = Number.isFinite(number) ? number : 0;
  return `Rs. ${safeNumber.toFixed(2)}`;
}
