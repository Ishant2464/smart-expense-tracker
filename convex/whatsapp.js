"use node";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

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
const TOLERANCE = 0.01;

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
      if (intent === "HELP") {
        return { success: true, reply: getHelpReply() };
      }

      if (intent === "BALANCE") {
        const balances = await ctx.runQuery(
          internal.whatsapp.getBalancesForWhatsApp,
          { userId: user._id }
        );
        return { success: true, reply: formatBalanceReply(balances) };
      }

      if (intent === "SUMMARY") {
        const summary = await ctx.runQuery(
          internal.whatsapp.getMonthlySpendingForWhatsApp,
          { userId: user._id }
        );
        return { success: true, reply: formatSummaryReply(summary) };
      }

      if (intent === "GROUPS") {
        const groups = await ctx.runQuery(
          internal.whatsapp.getGroupsForWhatsApp,
          { userId: user._id }
        );
        return { success: true, reply: formatGroupsReply(groups) };
      }

      if (intent === "RECENT") {
        const expenses = await ctx.runQuery(
          internal.whatsapp.getRecentExpensesForWhatsApp,
          { userId: user._id, limit: 5 }
        );
        return { success: true, reply: formatRecentExpensesReply(expenses) };
      }

      const expenseResult = await parseAndCreateExpenseForWhatsApp(ctx, {
        user,
        messageBody,
        groupId: user.defaultWhatsAppGroupId,
      });

      return {
        success: expenseResult.success,
        reply: expenseResult.reply,
      };
    } catch (error) {
      return {
        success: false,
        reply: `Sorry, I could not process that message. ${getErrorMessage(error)}`,
      };
    }
  },
});

export const getBalancesForWhatsApp = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const expenses = (await ctx.db.query("expenses").collect()).filter(
      (expense) =>
        !expense.groupId &&
        (expense.paidByUserId === args.userId ||
          expense.splits.some((split) => split.userId === args.userId))
    );
    const settlements = (await ctx.db.query("settlements").collect()).filter(
      (settlement) =>
        !settlement.groupId &&
        (settlement.paidByUserId === args.userId ||
          settlement.receivedByUserId === args.userId)
    );
    const balanceByUser = {};
    let youOwe = 0;
    let youAreOwed = 0;

    for (const expense of expenses) {
      const isPayer = expense.paidByUserId === args.userId;
      const mySplit = expense.splits.find(
        (split) => split.userId === args.userId
      );

      if (isPayer) {
        for (const split of expense.splits) {
          if (split.userId === args.userId || split.paid) continue;
          youAreOwed += split.amount;
          (balanceByUser[split.userId] ??= { owed: 0, owing: 0 }).owed +=
            split.amount;
        }
      } else if (mySplit && !mySplit.paid) {
        youOwe += mySplit.amount;
        (balanceByUser[expense.paidByUserId] ??= { owed: 0, owing: 0 }).owing +=
          mySplit.amount;
      }
    }

    for (const settlement of settlements) {
      if (settlement.paidByUserId === args.userId) {
        youOwe -= settlement.amount;
        (balanceByUser[settlement.receivedByUserId] ??= {
          owed: 0,
          owing: 0,
        }).owing -= settlement.amount;
      } else {
        youAreOwed -= settlement.amount;
        (balanceByUser[settlement.paidByUserId] ??= {
          owed: 0,
          owing: 0,
        }).owed -= settlement.amount;
      }
    }

    const youOweList = [];
    const youAreOwedByList = [];

    for (const [userId, balance] of Object.entries(balanceByUser)) {
      const net = balance.owed - balance.owing;
      if (Math.abs(net) <= TOLERANCE) continue;

      const otherUser = await ctx.db.get(userId);
      const item = {
        userId,
        name: otherUser?.name ?? "Unknown",
        amount: roundCurrency(Math.abs(net)),
      };

      if (net > 0) youAreOwedByList.push(item);
      else youOweList.push(item);
    }

    return {
      youOwe: roundCurrency(youOwe),
      youAreOwed: roundCurrency(youAreOwed),
      totalBalance: roundCurrency(youAreOwed - youOwe),
      youOweList: youOweList.sort((a, b) => b.amount - a.amount),
      youAreOwedByList: youAreOwedByList.sort((a, b) => b.amount - a.amount),
    };
  },
});

export const getMonthlySpendingForWhatsApp = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1).getTime();
    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_date", (q) => q.gte("date", startOfYear))
      .collect();
    const monthlyTotals = {};

    for (let i = 0; i < 12; i++) {
      const monthStart = new Date(currentYear, i, 1).getTime();
      monthlyTotals[monthStart] = 0;
    }

    for (const expense of expenses) {
      const split = expense.splits.find((item) => item.userId === args.userId);
      if (!split && expense.paidByUserId !== args.userId) continue;

      const date = new Date(expense.date);
      const monthStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        1
      ).getTime();
      monthlyTotals[monthStart] =
        (monthlyTotals[monthStart] ?? 0) + (split?.amount ?? 0);
    }

    return Object.entries(monthlyTotals)
      .map(([month, total]) => ({
        month: Number(month),
        label: new Date(Number(month)).toLocaleString("en-US", {
          month: "short",
        }),
        total: roundCurrency(total),
      }))
      .sort((a, b) => a.month - b.month);
  },
});

export const getGroupsForWhatsApp = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const groups = (await ctx.db.query("groups").collect()).filter((group) =>
      group.members.some((member) => member.userId === args.userId)
    );
    const result = [];

    for (const group of groups) {
      const expenses = await ctx.db
        .query("expenses")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      let balance = 0;

      for (const expense of expenses) {
        if (expense.paidByUserId === args.userId) {
          for (const split of expense.splits) {
            if (split.userId !== args.userId && !split.paid) {
              balance += split.amount;
            }
          }
        } else {
          const mySplit = expense.splits.find(
            (split) => split.userId === args.userId
          );
          if (mySplit && !mySplit.paid) balance -= mySplit.amount;
        }
      }

      result.push({
        groupId: group._id,
        name: group.name,
        memberCount: group.members.length,
        balance: roundCurrency(balance),
      });
    }

    return result.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getRecentExpensesForWhatsApp = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(Number(args.limit ?? 5), 1), 10);
    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_date")
      .order("desc")
      .collect();
    const results = [];

    for (const expense of expenses) {
      const split = expense.splits.find((item) => item.userId === args.userId);
      if (!split && expense.paidByUserId !== args.userId) continue;

      const payer = await ctx.db.get(expense.paidByUserId);
      results.push({
        description: expense.description,
        amount: roundCurrency(expense.amount),
        userShare: roundCurrency(split?.amount ?? 0),
        category: expense.category ?? "other",
        date: expense.date,
        paidByName: payer?.name ?? "Unknown",
      });

      if (results.length >= limit) break;
    }

    return results;
  },
});

export const getExpenseContextForWhatsApp = internalQuery({
  args: {
    userId: v.id("users"),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) throw new Error("User not found");

    if (args.groupId) {
      const group = await ctx.db.get(args.groupId);
      if (!group) throw new Error("Default WhatsApp group not found");

      const isMember = group.members.some(
        (member) => member.userId === args.userId
      );
      if (!isMember) throw new Error("User is not a member of the default group");

      const participants = [];
      for (const member of group.members) {
        const memberUser = await ctx.db.get(member.userId);
        if (memberUser) participants.push(formatParticipant(memberUser));
      }

      return {
        user: formatParticipant(user),
        group: { id: group._id, name: group.name },
        participants,
      };
    }

    const participants = new Map([[user._id, formatParticipant(user)]]);
    const personalExpenses = await ctx.db
      .query("expenses")
      .withIndex("by_group", (q) => q.eq("groupId", undefined))
      .collect();

    for (const expense of personalExpenses) {
      const involvesUser =
        expense.paidByUserId === args.userId ||
        expense.splits.some((split) => split.userId === args.userId);
      if (!involvesUser) continue;

      if (expense.paidByUserId !== args.userId) {
        const payer = await ctx.db.get(expense.paidByUserId);
        if (payer) participants.set(payer._id, formatParticipant(payer));
      }

      for (const split of expense.splits) {
        if (split.userId === args.userId) continue;
        const splitUser = await ctx.db.get(split.userId);
        if (splitUser) participants.set(splitUser._id, formatParticipant(splitUser));
      }
    }

    return {
      user: formatParticipant(user),
      group: null,
      participants: [...participants.values()],
    };
  },
});

export const createExpenseForWhatsApp = internalMutation({
  args: {
    createdByUserId: v.id("users"),
    description: v.string(),
    amount: v.number(),
    category: v.string(),
    date: v.number(),
    paidByUserId: v.id("users"),
    splitType: v.string(),
    splits: v.array(
      v.object({
        userId: v.id("users"),
        amount: v.number(),
        paid: v.boolean(),
      })
    ),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.createdByUserId);
    if (!user) throw new Error("User not found");

    if (args.groupId) {
      const group = await ctx.db.get(args.groupId);
      if (!group) throw new Error("Group not found");

      const memberIds = new Set(group.members.map((member) => member.userId));
      if (!memberIds.has(args.createdByUserId)) {
        throw new Error("User is not a member of this group");
      }
      if (!memberIds.has(args.paidByUserId)) {
        throw new Error("Payer is not a group member");
      }
      for (const split of args.splits) {
        if (!memberIds.has(split.userId)) {
          throw new Error("Split includes a user outside the group");
        }
      }
    }

    const totalSplitAmount = args.splits.reduce(
      (sum, split) => sum + split.amount,
      0
    );
    if (Math.abs(totalSplitAmount - args.amount) > TOLERANCE) {
      throw new Error("Split amounts must add up to the expense amount");
    }

    return await ctx.db.insert("expenses", {
      description: args.description,
      amount: args.amount,
      category: args.category || "other",
      date: args.date,
      paidByUserId: args.paidByUserId,
      splitType: args.splitType,
      splits: args.splits,
      groupId: args.groupId,
      createdBy: args.createdByUserId,
    });
  },
});

async function parseAndCreateExpenseForWhatsApp(
  ctx,
  { user, messageBody, groupId }
) {
  const context = await ctx.runQuery(
    internal.whatsapp.getExpenseContextForWhatsApp,
    {
      userId: user._id,
      ...(groupId ? { groupId } : {}),
    }
  );
  const modelText = await generateGeminiText(buildExpensePrompt(context, messageBody));
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
    return {
      success: false,
      reply:
        `I found an expense but need confirmation before adding it.\n` +
        `${normalized.description} - ${formatCurrency(normalized.amount)}\n` +
        `Warnings: ${normalized.warnings.join(" ") || "low confidence"}`,
    };
  }

  const expenseId = await ctx.runMutation(
    internal.whatsapp.createExpenseForWhatsApp,
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

  const payer = context.participants.find(
    (participant) => participant.userId === normalized.paidByUserId
  );
  const participantCount = normalized.participantUserIds.length;
  const eachAmount =
    normalized.splitType === "equal" && participantCount > 0
      ? normalized.amount / participantCount
      : null;

  return {
    success: true,
    reply:
      `Added: ${normalized.description} ${formatCurrency(normalized.amount)}\n` +
      `Paid by: ${payer?.name ?? "Unknown"}\n` +
      `Split: ${normalized.splitType} among ${participantCount} people` +
      (eachAmount ? `\nEach: ${formatCurrency(eachAmount)}` : "") +
      `\nExpense ID: ${expenseId}`,
  };
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
    "- 'balance' - check who owes you",
    "- 'summary' - monthly spending overview",
    "- 'groups' - list your groups",
    "- 'recent' - last 5 expenses",
    "- 'help' - show this message",
  ].join("\n");
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

async function generateGeminiText(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

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
  const participantUserIds = normalizeParticipantIds(
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
  if (splitType !== "equal") {
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

function formatParticipant(user) {
  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
  };
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

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount) {
  return `Rs. ${roundCurrency(amount).toFixed(2)}`;
}

function clampConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) return 0.5;
  return Math.min(1, Math.max(0, confidence));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
