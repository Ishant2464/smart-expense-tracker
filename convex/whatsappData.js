import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const TOLERANCE = 0.01;

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

export const getPendingExpenseForWhatsApp = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("pendingWhatsAppExpenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();

    if (!pending) return null;

    if (pending.expiresAt <= Date.now()) {
      return null;
    }

    return pending;
  },
});

export const savePendingExpenseForWhatsApp = internalMutation({
  args: {
    userId: v.id("users"),
    messageBody: v.string(),
    status: v.optional(v.string()),
    parsedExpense: v.optional(v.any()),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pendingWhatsAppExpenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    for (const item of existing) {
      await ctx.db.delete(item._id);
    }

    return await ctx.db.insert("pendingWhatsAppExpenses", {
      userId: args.userId,
      messageBody: args.messageBody,
      status: args.status,
      parsedExpense: args.parsedExpense,
      groupId: args.groupId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  },
});

export const savePendingParsedExpenseForWhatsApp = internalMutation({
  args: {
    pendingId: v.id("pendingWhatsAppExpenses"),
    parsedExpense: v.any(),
    groupId: v.optional(v.id("groups")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.pendingId, {
      status: "awaiting_confirmation",
      parsedExpense: args.parsedExpense,
      groupId: args.groupId,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return { success: true };
  },
});

export const clearPendingExpenseForWhatsApp = internalMutation({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("pendingWhatsAppExpenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    for (const item of existing) {
      await ctx.db.delete(item._id);
    }

    return { success: true };
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

function formatParticipant(user) {
  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
  };
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}