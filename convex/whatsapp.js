"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateGroqText } from "./aiProviders.js";

const ALLOWED_CATEGORY_IDS = [
  "foodDrink",
  "coffee",
  "groceries",
  "shopping",
  "travel",
  "transportation",
  "housing",
  "entertainment",
  "tickets",
  "utilities",
  "water",
  "education",
  "health",
  "personal",
  "gifts",
  "technology",
  "bills",
  "baby",
  "music",
  "books",
  "other",
  "general",
];

const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const PENDING_SELECTION_REGEX = /^(?:(?:group\s*)?\d+|individual|personal|cancel)$/i;
const CONFIRM_SELECTION_REGEX = /^(?:confirm|yes|y|add|create|cancel)$/i;

export const processWhatsAppMessage = action({
  args: {
    fromPhone: v.string(),
    messageBody: v.string(),
  },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.fromPhone);
    const messageBody = args.messageBody.trim();

    if (!messageBody) {
      return {
        success: true,
        reply: "Please send a message like 'paid 200 for milk' or type 'help'.",
      };
    }

    const user = await ctx.runQuery(internal.users.getUserByPhone, { phone });

    if (!user) {
      return {
        success: false,
        reply:
          "Your phone number is not linked to a Splitr account. Visit the app to connect your WhatsApp.",
      };
    }

    const intent = detectIntent(messageBody);

    try {
      const pending = await ctx.runQuery(
        internal.whatsappData.getPendingExpenseForWhatsApp,
        { userId: user._id }
      );

      if (pending?.status === "awaiting_confirmation") {
        if (CONFIRM_SELECTION_REGEX.test(messageBody)) {
          return await handlePendingExpenseConfirmation(ctx, {
            user,
            pending,
            messageBody,
          });
        }

        return {
          success: true,
          reply: "Reply 'confirm' to add this expense, or 'cancel' to discard it.",
        };
      }

      if (pending && PENDING_SELECTION_REGEX.test(messageBody)) {
        return await handlePendingExpenseSelection(ctx, {
          user,
          pending,
          messageBody,
        });
      }

      if (intent === "HELP") {
        return { success: true, reply: getHelpReply() };
      }

      if (intent === "BALANCE") {
        const balances = await ctx.runQuery(
          internal.whatsappData.getBalancesForWhatsApp,
          { userId: user._id }
        );
        return { success: true, reply: formatBalanceReply(balances) };
      }

      if (intent === "SUMMARY") {
        const summary = await ctx.runQuery(
          internal.whatsappData.getMonthlySpendingForWhatsApp,
          { userId: user._id }
        );
        return { success: true, reply: formatSummaryReply(summary) };
      }

      if (intent === "GROUPS") {
        const groups = await ctx.runQuery(
          internal.whatsappData.getGroupsForWhatsApp,
          { userId: user._id }
        );
        return { success: true, reply: formatGroupsReply(groups) };
      }

      if (intent === "RECENT") {
        const expenses = await ctx.runQuery(
          internal.whatsappData.getRecentExpensesForWhatsApp,
          { userId: user._id, limit: 5 }
        );
        return { success: true, reply: formatRecentExpensesReply(expenses) };
      }

      await ctx.runMutation(internal.whatsappData.savePendingExpenseForWhatsApp, {
        userId: user._id,
        messageBody,
      });

      const groups = await ctx.runQuery(
        internal.whatsappData.getGroupsForWhatsApp,
        { userId: user._id }
      );

      return {
        success: true,
        reply: formatExpenseContextPrompt(messageBody, groups),
      };
    } catch (error) {
      return {
        success: false,
        reply: `Sorry, I could not process that message. ${getErrorMessage(error)}`,
      };
    }
  },
});

async function handlePendingExpenseConfirmation(
  ctx,
  { user, pending, messageBody }
) {
  const text = messageBody.trim().toLowerCase();

  if (text === "cancel") {
    await ctx.runMutation(internal.whatsappData.clearPendingExpenseForWhatsApp, {
      userId: user._id,
    });
    return { success: true, reply: "Cancelled that pending expense." };
  }

  if (!pending.parsedExpense) {
    await ctx.runMutation(internal.whatsappData.clearPendingExpenseForWhatsApp, {
      userId: user._id,
    });
    return {
      success: false,
      reply: "That pending expense expired. Please send the expense again.",
    };
  }

  const expenseId = await createNormalizedWhatsAppExpense(ctx, {
    user,
    normalized: pending.parsedExpense,
    groupId: pending.groupId,
  });

  await ctx.runMutation(internal.whatsappData.clearPendingExpenseForWhatsApp, {
    userId: user._id,
  });

  return {
    success: true,
    reply: formatCreatedExpenseReply(pending.parsedExpense, expenseId),
  };
}

async function handlePendingExpenseSelection(ctx, { user, pending, messageBody }) {
  const selection = normalizePendingSelection(messageBody);

  if (selection.type === "cancel") {
    await ctx.runMutation(internal.whatsappData.clearPendingExpenseForWhatsApp, {
      userId: user._id,
    });
    return { success: true, reply: "Cancelled that pending expense." };
  }

  const groups = await ctx.runQuery(internal.whatsappData.getGroupsForWhatsApp, {
    userId: user._id,
  });
  const selectedGroup =
    selection.type === "group" ? groups[selection.index - 1] : null;

  if (selection.type === "group" && !selectedGroup) {
    return {
      success: false,
      reply:
        `Please choose a valid option.\n` +
        formatExpenseContextOptions(groups),
    };
  }

  const expenseResult = await parseAndCreateExpenseForWhatsApp(ctx, {
    user,
    messageBody: pending.messageBody,
    groupId: selectedGroup?.groupId,
    pendingId: pending._id,
  });

  if (expenseResult.success) {
    await ctx.runMutation(internal.whatsappData.clearPendingExpenseForWhatsApp, {
      userId: user._id,
    });
  }

  return {
    success: expenseResult.success,
    reply: expenseResult.reply,
  };
}

async function parseAndCreateExpenseForWhatsApp(
  ctx,
  { user, messageBody, groupId, pendingId }
) {
  const context = await ctx.runQuery(
    internal.whatsappData.getExpenseContextForWhatsApp,
    {
      userId: user._id,
      ...(groupId ? { groupId } : {}),
    }
  );
  const modelText = await generateGroqText(buildExpensePrompt(context, messageBody));
  const parsed = parseJsonFromModel(modelText);

  if (!parsed.success) {
    return {
      success: false,
      reply:
        "I could not understand that expense. Try: 'paid 200 for milk' or 'Rahul paid 500 for dinner split equally'.",
    };
  }

  const normalized = normalizeParsedExpense(parsed.value, context);
  if (!normalized.success) {
    return { success: false, reply: normalized.reply };
  }

  if (
    normalized.confidence < HIGH_CONFIDENCE_THRESHOLD ||
    normalized.requiresConfirmation
  ) {
    if (pendingId) {
      await ctx.runMutation(
        internal.whatsappData.savePendingParsedExpenseForWhatsApp,
        {
          pendingId,
          parsedExpense: normalized,
          ...(groupId ? { groupId } : {}),
        }
      );
    }

    return {
      success: false,
      reply:
        `I found an expense but need confirmation before adding it.\n` +
        `${normalized.description} - ${formatCurrency(normalized.amount)}\n` +
        `Warnings: ${normalized.warnings.join(" ") || "low confidence"}\n` +
        `Reply 'confirm' to add it, or 'cancel' to discard it.`,
    };
  }

  const expenseId = await createNormalizedWhatsAppExpense(ctx, {
    user,
    normalized,
    groupId,
  });

  return {
    success: true,
    reply: formatCreatedExpenseReply(normalized, expenseId),
  };
}

async function createNormalizedWhatsAppExpense(ctx, { user, normalized, groupId }) {
  return await ctx.runMutation(
    internal.whatsappData.createExpenseForWhatsApp,
    {
      createdByUserId: user._id,
      description: normalized.description,
      amount: normalized.amount,
      category: normalized.category,
      date: normalized.date,
      paidByUserId: normalized.paidByUserId,
      splitType: normalized.splitType,
      splits: normalized.splits,
      ...(groupId ? { groupId } : {}),
    }
  );
}

function formatCreatedExpenseReply(normalized, expenseId) {
  const participantCount = normalized.participantUserIds.length;
  const eachAmount =
    normalized.splitType === "equal" && participantCount > 0
      ? normalized.amount / participantCount
      : null;

  return (
    `Added: ${normalized.description} ${formatCurrency(normalized.amount)}\n` +
    `Split: ${normalized.splitType} among ${participantCount} people` +
    (eachAmount ? `\nEach: ${formatCurrency(eachAmount)}` : "") +
    `\nExpense ID: ${expenseId}`
  );
}

function detectIntent(messageBody) {
  const text = messageBody.toLowerCase();

  if (/\b(help|commands)\b/.test(text)) return "HELP";
  if (/\b(balance|balances|what do i owe|who owes me)\b/.test(text)) {
    return "BALANCE";
  }
  if (/\b(summary|monthly|spending|report)\b/.test(text)) return "SUMMARY";
  if (/\b(groups|my groups)\b/.test(text)) return "GROUPS";
  if (/\b(recent|last expenses|history)\b/.test(text)) return "RECENT";
  return "EXPENSE";
}

function getHelpReply() {
  return [
    "Splitr WhatsApp Commands:",
    "- Type any expense like: 'paid 200 for milk'",
    "- After sending an expense, reply 'individual' or a group number to choose where to add it",
    "- 'balance' - check who owes you",
    "- 'summary' - monthly spending overview",
    "- 'groups' - list your groups",
    "- 'recent' - last 5 expenses",
    "- 'help' - show this message",
  ].join("\n");
}

function formatExpenseContextPrompt(messageBody, groups) {
  return [
    `Where should I add this expense?`,
    `"${messageBody}"`,
    "",
    formatExpenseContextOptions(groups),
  ].join("\n");
}

function formatExpenseContextOptions(groups) {
  const lines = ["Reply with:", "- individual" ];

  if (groups.length) {
    lines.push(
      ...groups.map(
        (group, index) =>
          `- ${index + 1} for ${group.name} (${group.memberCount} members)`
      )
    );
  }

  lines.push("- cancel");
  return lines.join("\n");
}

function formatBalanceReply(balances) {
  const lines = [
    "Splitr balance:",
    `You owe: ${formatCurrency(balances.youOwe)}`,
    `You are owed: ${formatCurrency(balances.youAreOwed)}`,
    `Net: ${formatCurrency(balances.totalBalance)}`,
  ];

  if (balances.youOweList.length) {
    lines.push(
      "",
      "You owe:",
      ...balances.youOweList.map(
        (item) => `- ${item.name}: ${formatCurrency(item.amount)}`
      )
    );
  }

  if (balances.youAreOwedByList.length) {
    lines.push(
      "",
      "Owes you:",
      ...balances.youAreOwedByList.map(
        (item) => `- ${item.name}: ${formatCurrency(item.amount)}`
      )
    );
  }

  return lines.join("\n");
}

function formatSummaryReply(summary) {
  const nonZeroMonths = summary.filter((month) => month.total > 0);
  if (!nonZeroMonths.length) {
    return "No spending found for this year yet.";
  }

  const total = nonZeroMonths.reduce((sum, month) => sum + month.total, 0);
  return [
    "Monthly spending:",
    ...nonZeroMonths.map(
      (month) => `- ${month.label}: ${formatCurrency(month.total)}`
    ),
    `Total: ${formatCurrency(total)}`,
  ].join("\n");
}

function formatGroupsReply(groups) {
  if (!groups.length) return "You are not in any Splitr groups yet.";

  return [
    "Your groups:",
    ...groups.map(
      (group) =>
        `- ${group.name} (${group.memberCount} members): ${formatCurrency(group.balance)}`
    ),
  ].join("\n");
}

function formatRecentExpensesReply(expenses) {
  if (!expenses.length) return "No recent expenses found.";

  return [
    "Recent expenses:",
    ...expenses.map(
      (expense, index) =>
        `${index + 1}. ${expense.description} - ${formatCurrency(
          expense.amount
        )} (${expense.paidByName} paid)`
    ),
  ].join("\n");
}

function buildExpensePrompt(context, messageBody) {
  return `
Parse this WhatsApp message into a Splitr expense.

Current user:
- name: ${context.user.name}
- userId: ${context.user.userId}

${context.group ? `Default group: ${context.group.name}` : "No default group."}

Available participants:
${context.participants
  .map(
    (participant) =>
      `- ${participant.name}; userId: ${participant.userId}; email: ${participant.email}`
  )
  .join("\n")}

Allowed category IDs:
${ALLOWED_CATEGORY_IDS.join(", ")}

Rules:
- Return strict JSON only.
- Use only listed userId values.
- If payer is ambiguous, use the current user.
- If participants are ambiguous and a default group exists, use all group members.
- If participants are ambiguous and no group exists, use only the current user.
- categoryId must be one of the allowed category IDs.
- splitType must be "equal", "percentage", or "exact"; default to "equal".
- confidence must be 0 to 1.

Return:
{
  "description": "short description",
  "amount": 0,
  "categoryId": "other",
  "paidByUserId": "${context.user.userId}",
  "participantUserIds": ["${context.user.userId}"],
  "splitType": "equal",
  "relativeDate": null,
  "confidence": 0,
  "warnings": []
}

Message:
${messageBody}
  `.trim();
}

function parseJsonFromModel(text) {
  const jsonText = extractJsonObject(stripMarkdownFences(text));
  if (!jsonText) {
    return { success: false, error: "No JSON found" };
  }

  try {
    return { success: true, value: JSON.parse(jsonText) };
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

function normalizeParsedExpense(parsed, context) {
  const warnings = normalizeWarnings(parsed.warnings);
  const participantMap = new Map(
    context.participants.map((participant) => [participant.userId, participant])
  );
  const amount = Number(parsed.amount);
  const description =
    typeof parsed.description === "string" ? parsed.description.trim() : "";

  if (!description) {
    return { success: false, reply: "I could not find an expense description." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, reply: "I could not find a valid amount." };
  }

  const paidByUserId = participantMap.has(parsed.paidByUserId)
    ? parsed.paidByUserId
    : context.user.userId;
  const participantUserIds = context.group
    ? context.participants.map((participant) => participant.userId)
    : normalizeParticipantIds(
        parsed.participantUserIds,
        paidByUserId,
        context,
        warnings
      );
  const category = ALLOWED_CATEGORY_IDS.includes(parsed.categoryId)
    ? parsed.categoryId
    : "other";
  if (category === "other" && parsed.categoryId && parsed.categoryId !== "other") {
    warnings.push("Category was unclear, so other was used.");
  }

  const splitType = ["equal", "percentage", "exact"].includes(parsed.splitType)
    ? parsed.splitType
    : "equal";
  if (context.group && splitType !== "equal") {
    warnings.push("Group WhatsApp expenses are split equally among all group members.");
  } else if (splitType !== "equal") {
    warnings.push("Only equal WhatsApp splits are auto-created right now.");
  }

  const finalSplitType = "equal";
  const splits = buildEqualSplits(roundCurrency(amount), participantUserIds, paidByUserId);
  const confidence = clampConfidence(parsed.confidence);
  const date = normalizeRelativeDate(parsed.relativeDate);

  return {
    success: true,
    description: description.slice(0, 160),
    amount: roundCurrency(amount),
    category,
    date,
    paidByUserId,
    participantUserIds,
    splitType: finalSplitType,
    splits,
    confidence,
    warnings,
    requiresConfirmation: warnings.length > 0 || participantUserIds.length === 0,
  };
}

function normalizeParticipantIds(rawIds, paidByUserId, context, warnings) {
  const allowedIds = new Set(
    context.participants.map((participant) => participant.userId)
  );
  const ids = Array.isArray(rawIds) ? rawIds : [context.user.userId];
  const result = [];

  for (const id of ids) {
    if (typeof id !== "string" || result.includes(id)) continue;
    if (!allowedIds.has(id)) {
      warnings.push("Some participants were not recognized and were skipped.");
      continue;
    }
    result.push(id);
  }

  if (!result.includes(paidByUserId)) result.push(paidByUserId);
  if (!result.length) result.push(context.user.userId);

  return result;
}

function buildEqualSplits(amount, participantUserIds, paidByUserId) {
  const share = amount / participantUserIds.length;
  const amounts = participantUserIds.map(() => roundCurrency(share));
  const subtotal = amounts.reduce((sum, value) => sum + value, 0);
  const difference = roundCurrency(amount - subtotal);
  amounts[amounts.length - 1] = roundCurrency(
    amounts[amounts.length - 1] + difference
  );

  return participantUserIds.map((userId, index) => ({
    userId,
    amount: amounts[index],
    paid: userId === paidByUserId,
  }));
}

function normalizeRelativeDate(relativeDate) {
  const now = new Date();
  if (typeof relativeDate !== "string") return now.getTime();

  const text = relativeDate.trim().toLowerCase();
  if (text === "yesterday" || text === "last night") {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return date.getTime();
  }

  return now.getTime();
}

function normalizeWarnings(warnings) {
  if (!Array.isArray(warnings)) return [];
  return [...new Set(warnings.filter((warning) => typeof warning === "string"))];
}

function stripMarkdownFences(text) {
  const trimmed = String(text ?? "").trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function extractJsonObject(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  return text.slice(firstBrace, lastBrace + 1);
}

function normalizePhone(phone) {
  return String(phone ?? "").replace(/^whatsapp:/i, "").replace(/\s+/g, "").trim();
}

function normalizePendingSelection(messageBody) {
  const text = messageBody.trim().toLowerCase();

  if (text === "cancel") return { type: "cancel" };
  if (text === "individual" || text === "personal") return { type: "individual" };

  const match = text.match(/^(?:group\s*)?(\d+)$/);
  if (match) {
    return { type: "group", index: Number(match[1]) };
  }

  return { type: "unknown" };
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount) {
  return `₹${roundCurrency(amount).toFixed(2)}`;
}

function clampConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0.5;
  return Math.min(1, Math.max(0, confidence));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
