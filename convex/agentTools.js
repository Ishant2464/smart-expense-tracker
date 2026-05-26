import { api, internal } from "./_generated/api";

export const TOOL_DEFINITIONS = [
  {
    name: "getMyBalances",
    description:
      "Get the current user's overall balance summary including who they owe and who owes them",
    parameters: "No parameters.",
  },
  {
    name: "getMyMonthlySpending",
    description:
      "Get the current user's spending breakdown by month for the current year",
    parameters: "No parameters.",
  },
  {
    name: "getMyGroups",
    description:
      "Get all groups the current user belongs to with their balance in each group",
    parameters: "No parameters.",
  },
  {
    name: "getGroupDetails",
    description:
      "Get detailed expenses, settlements, balances, and members for a specific group",
    parameters: '{ "groupName": "string" }',
  },
  {
    name: "getRecentExpenses",
    description:
      "Get the user's most recent expenses, optionally filtered by category or limited by count",
    parameters: '{ "limit": "optional number, default 10", "category": "optional string" }',
  },
  {
    name: "getExpensesWithPerson",
    description:
      "Get expenses and balance between the current user and a specific person",
    parameters: '{ "personName": "string" }',
  },
  {
    name: "addExpense",
    description: "Add a new expense by parsing a natural language description",
    parameters:
      '{ "description": "string", "groupName": "optional string" }',
  },
  {
    name: "sendPaymentReminder",
    description:
      "Send a payment reminder email to a specific person who owes the current user",
    parameters: '{ "personName": "string" }',
  },
];

const TOOL_EXECUTORS = {
  getMyBalances,
  getMyMonthlySpending,
  getMyGroups,
  getGroupDetails,
  getRecentExpenses,
  getExpensesWithPerson,
  addExpense,
  sendPaymentReminder,
};

export async function executeToolCall(ctx, toolName, toolArgs = {}) {
  const executor = TOOL_EXECUTORS[toolName];

  if (!executor) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
    };
  }

  try {
    return await executor(ctx, normalizeToolArgs(toolArgs));
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
}

async function getMyBalances(ctx) {
  const balances = await ctx.runQuery(api.dashboard.getUserBalances);

  return {
    success: true,
    data: {
      youOwe: roundMoney(balances.youOwe),
      youAreOwed: roundMoney(balances.youAreOwed),
      totalBalance: roundMoney(balances.totalBalance),
      youOweDetails: balances.oweDetails.youOwe.map((item) => ({
        userId: item.userId,
        name: item.name,
        amount: roundMoney(item.amount),
      })),
      youAreOwedBy: balances.oweDetails.youAreOwedBy.map((item) => ({
        userId: item.userId,
        name: item.name,
        amount: roundMoney(item.amount),
      })),
    },
  };
}

async function getMyMonthlySpending(ctx) {
  const monthlySpending = await ctx.runQuery(api.dashboard.getMonthlySpending);

  return {
    success: true,
    data: monthlySpending.map((item) => ({
      month: new Date(item.month).toLocaleString("en-US", {
        month: "short",
        year: "numeric",
      }),
      total: roundMoney(item.total),
    })),
  };
}

async function getMyGroups(ctx) {
  const groups = await ctx.runQuery(api.dashboard.getUserGroups);

  return {
    success: true,
    data: groups.map((group) => ({
      groupId: group.id ?? group._id,
      name: group.name,
      description: group.description ?? "",
      memberCount: group.members?.length ?? group.memberCount ?? 0,
      balance: roundMoney(group.balance ?? 0),
    })),
  };
}

async function getGroupDetails(ctx, args) {
  const groupName = requiredString(args.groupName, "groupName");
  if (!groupName.success) return groupName;

  const context = await ctx.runQuery(internal.chat.getAgentContext);
  const group = findBestMatch(context.groups, groupName.value, "name");

  if (!group) {
    return {
      success: false,
      error: `I could not find a group matching "${groupName.value}".`,
    };
  }

  const data = await ctx.runQuery(api.groups.getGroupExpenses, {
    groupId: group.groupId,
  });

  return {
    success: true,
    data: {
      group: data.group,
      members: data.members.map((member) => ({
        userId: member.id,
        name: member.name,
        role: member.role,
      })),
      recentExpenses: data.expenses
        .slice()
        .sort((a, b) => b.date - a.date)
        .slice(0, 10)
        .map((expense) => ({
          description: expense.description,
          amount: roundMoney(expense.amount),
          category: expense.category,
          date: expense.date,
          paidByName:
            data.userLookupMap[expense.paidByUserId]?.name ?? "Unknown",
        })),
      balances: data.balances.map((balance) => ({
        userId: balance.id,
        name: balance.name,
        totalBalance: roundMoney(balance.totalBalance),
        owes: balance.owes.map((item) => ({
          to: item.to,
          amount: roundMoney(item.amount),
        })),
        owedBy: balance.owedBy.map((item) => ({
          from: item.from,
          amount: roundMoney(item.amount),
        })),
      })),
      settlementCount: data.settlements.length,
    },
  };
}

async function getRecentExpenses(ctx, args) {
  const data = await ctx.runQuery(internal.chat.getRecentExpensesForAgent, {
    limit: args.limit,
    category: args.category,
  });

  return {
    success: true,
    data,
  };
}

async function getExpensesWithPerson(ctx, args) {
  const personName = requiredString(args.personName, "personName");
  if (!personName.success) return personName;

  const context = await ctx.runQuery(internal.chat.getAgentContext);
  const person = findBestMatch(context.contacts, personName.value, "name");

  if (!person) {
    return {
      success: false,
      error: `I could not find a contact matching "${personName.value}".`,
    };
  }

  const data = await ctx.runQuery(api.expenses.getExpensesBetweenUsers, {
    userId: person.userId,
  });

  return {
    success: true,
    data: {
      person: data.otherUser,
      balance: roundMoney(data.balance),
      recentExpenses: data.expenses.slice(0, 10).map((expense) => ({
        description: expense.description,
        amount: roundMoney(expense.amount),
        category: expense.category,
        date: expense.date,
        paidByUserId: expense.paidByUserId,
      })),
      recentSettlements: data.settlements.slice(0, 5).map((settlement) => ({
        amount: roundMoney(settlement.amount),
        date: settlement.date,
        paidByUserId: settlement.paidByUserId,
        receivedByUserId: settlement.receivedByUserId,
      })),
    },
  };
}

async function addExpense(ctx, args) {
  const description = requiredString(args.description, "description");
  if (!description.success) return description;

  let groupId;

  if (args.groupName) {
    const context = await ctx.runQuery(internal.chat.getAgentContext);
    const group = findBestMatch(context.groups, String(args.groupName), "name");

    if (!group) {
      return {
        success: false,
        error: `I could not find a group matching "${args.groupName}".`,
      };
    }

    groupId = group.groupId;
  }

  const result = await ctx.runAction(api.ai.parseNaturalLanguageExpense, {
    naturalLanguageInput: description.value,
    ...(groupId ? { groupId } : {}),
    autoCreate: true,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      warnings: result.warnings ?? [],
    };
  }

  return {
    success: true,
    data: {
      created: Boolean(result.createdExpenseId),
      createdExpenseId: result.createdExpenseId,
      confidence: result.confidence,
      requiresConfirmation: result.requiresConfirmation,
      warnings: result.warnings,
      preview: result.parsedPreview,
      payer: result.resolvedPayer,
      participants: result.resolvedParticipants,
      group: result.groupContext,
    },
  };
}

async function sendPaymentReminder(ctx, args) {
  const personName = requiredString(args.personName, "personName");
  if (!personName.success) return personName;

  const context = await ctx.runQuery(internal.chat.getAgentContext);
  const person = findBestMatch(context.contacts, personName.value, "name");

  if (!person) {
    return {
      success: false,
      error: `I could not find a contact matching "${personName.value}".`,
    };
  }

  const balances = await ctx.runQuery(api.dashboard.getUserBalances);
  const debt = balances.oweDetails.youAreOwedBy.find(
    (item) => item.userId === person.userId
  );

  if (!debt || debt.amount <= 0) {
    return {
      success: false,
      error: `${person.name} does not currently owe you money.`,
    };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      error: "RESEND_API_KEY is not configured.",
    };
  }

  const amount = roundMoney(debt.amount);
  const emailResult = await ctx.runAction(api.email.sendEmail, {
    to: person.email,
    subject: `Payment reminder from ${context.user.name}`,
    html: `
      <p>Hi ${escapeHtml(person.name)},</p>
      <p>${escapeHtml(context.user.name)} sent you a friendly reminder about your Splitr balance.</p>
      <p><strong>Amount owed: ${formatCurrency(amount)}</strong></p>
      <p>Please settle up when you can.</p>
    `,
    text: `Hi ${person.name}, ${context.user.name} sent you a friendly Splitr reminder. Amount owed: ${formatCurrency(amount)}.`,
    apiKey,
  });

  if (!emailResult.success) {
    return {
      success: false,
      error: emailResult.error ?? "Failed to send reminder email.",
    };
  }

  return {
    success: true,
    data: {
      sentTo: person.email,
      personName: person.name,
      amount,
      emailId: emailResult.id,
    },
  };
}

function normalizeToolArgs(toolArgs) {
  if (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
    return {};
  }

  return toolArgs;
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    return {
      success: false,
      error: `Missing required parameter: ${fieldName}`,
    };
  }

  return {
    success: true,
    value: value.trim(),
  };
}

function findBestMatch(items, query, field) {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return null;

  return (
    items.find((item) => normalizeForSearch(item[field]) === normalizedQuery) ??
    items.find((item) =>
      normalizeForSearch(item[field]).startsWith(normalizedQuery)
    ) ??
    items.find((item) =>
      normalizeForSearch(item[field]).includes(normalizedQuery)
    ) ??
    items.find((item) =>
      normalizedQuery.includes(normalizeForSearch(item[field]))
    ) ??
    null
  );
}

function normalizeForSearch(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

function roundMoney(amount) {
  return Math.round((Number(amount) + Number.EPSILON) * 100) / 100;
}

function formatCurrency(amount) {
  return `₹${roundMoney(amount).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
