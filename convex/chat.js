import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_THREAD_TITLE = "New chat";

export const getUserThreads = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);

    return await ctx.db
      .query("chatThreads")
      .withIndex("by_user_recent", (q) => q.eq("userId", user._id))
      .order("desc")
      .collect();
  },
});

export const getThreadMessages = query({
  args: {
    threadId: v.id("chatThreads"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    await getOwnedThread(ctx, args.threadId, user._id);

    return await ctx.db
      .query("chatMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("asc")
      .collect();
  },
});

export const createThread = mutation({
  args: {
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    const now = Date.now();
    const title = normalizeTitle(args.title);

    return await ctx.db.insert("chatThreads", {
      userId: user._id,
      title,
      createdAt: now,
      lastMessageAt: now,
    });
  },
});

export const deleteThread = mutation({
  args: {
    threadId: v.id("chatThreads"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    await getOwnedThread(ctx, args.threadId, user._id);

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    await ctx.db.delete(args.threadId);

    return { success: true };
  },
});

export const addMessage = mutation({
  args: {
    threadId: v.id("chatThreads"),
    role: v.string(),
    content: v.string(),
    toolName: v.optional(v.string()),
    toolArgs: v.optional(v.string()),
    toolResult: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    const thread = await getOwnedThread(ctx, args.threadId, user._id);
    const now = Date.now();

    const messageId = await ctx.db.insert("chatMessages", {
      threadId: args.threadId,
      role: args.role,
      content: args.content,
      toolName: args.toolName,
      toolArgs: args.toolArgs,
      toolResult: args.toolResult,
      timestamp: now,
    });

    const patch = { lastMessageAt: now };
    if (thread.title === DEFAULT_THREAD_TITLE && args.role === "user") {
      patch.title = createTitleFromMessage(args.content);
    }

    await ctx.db.patch(args.threadId, patch);

    return messageId;
  },
});

export const getAgentContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    const contacts = await getContactUsers(ctx, user);
    const groups = await getUserGroupsWithMembers(ctx, user);

    return {
      user: formatUser(user),
      contacts,
      groups,
    };
  },
});

export const getRecentExpensesForAgent = internalQuery({
  args: {
    limit: v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    const limit = clampLimit(args.limit, 10, 25);
    const category = args.category?.trim().toLowerCase();
    const userCache = new Map();
    const groupCache = new Map();
    const expenses = await ctx.db
      .query("expenses")
      .withIndex("by_date")
      .order("desc")
      .collect();
    const results = [];

    for (const expense of expenses) {
      if (!isExpenseInvolvingUser(expense, user._id)) continue;
      if (
        category &&
        String(expense.category ?? "")
          .toLowerCase()
          .trim() !== category
      ) {
        continue;
      }

      const payer = await getCachedUser(ctx, userCache, expense.paidByUserId);
      const group = expense.groupId
        ? await getCachedGroup(ctx, groupCache, expense.groupId)
        : null;

      results.push({
        id: expense._id,
        description: expense.description,
        amount: expense.amount,
        category: expense.category ?? "other",
        date: expense.date,
        paidByUserId: expense.paidByUserId,
        paidByName: payer?.name ?? "Unknown",
        groupId: expense.groupId,
        groupName: group?.name ?? null,
        userShare:
          expense.splits.find((split) => split.userId === user._id)?.amount ??
          0,
      });

      if (results.length >= limit) break;
    }

    return results;
  },
});

export const getThreadForAgent = internalQuery({
  args: {
    threadId: v.id("chatThreads"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    const thread = await getOwnedThread(ctx, args.threadId, user._id);

    return thread;
  },
});

async function getOwnedThread(ctx, threadId, userId) {
  const thread = await ctx.db.get(threadId);

  if (!thread || thread.userId !== userId) {
    throw new Error("Chat thread not found");
  }

  return thread;
}

function normalizeTitle(title) {
  if (typeof title !== "string") {
    return DEFAULT_THREAD_TITLE;
  }

  const trimmed = title.trim();
  return trimmed ? trimmed.slice(0, 80) : DEFAULT_THREAD_TITLE;
}

function createTitleFromMessage(content) {
  const compact = content.trim().replace(/\s+/g, " ");
  return compact ? compact.slice(0, 60) : DEFAULT_THREAD_TITLE;
}

async function getContactUsers(ctx, user) {
  const personalExpenses = await getPersonalExpensesForUser(ctx, user._id);
  const contactIds = new Set();

  for (const expense of personalExpenses) {
    if (expense.paidByUserId !== user._id) {
      contactIds.add(expense.paidByUserId);
    }

    for (const split of expense.splits) {
      if (split.userId !== user._id) {
        contactIds.add(split.userId);
      }
    }
  }

  const contacts = [];
  for (const contactId of contactIds) {
    const contact = await ctx.db.get(contactId);
    if (contact) contacts.push(formatUser(contact));
  }

  contacts.sort((a, b) => a.name.localeCompare(b.name));
  return contacts;
}

async function getPersonalExpensesForUser(ctx, userId) {
  const paidByUser = await ctx.db
    .query("expenses")
    .withIndex("by_user_and_group", (q) =>
      q.eq("paidByUserId", userId).eq("groupId", undefined)
    )
    .collect();
  const personalExpenses = await ctx.db
    .query("expenses")
    .withIndex("by_group", (q) => q.eq("groupId", undefined))
    .collect();
  const involvingUser = personalExpenses.filter(
    (expense) =>
      expense.paidByUserId !== userId &&
      expense.splits.some((split) => split.userId === userId)
  );

  return dedupeById([...paidByUser, ...involvingUser]);
}

async function getUserGroupsWithMembers(ctx, user) {
  const groups = (await ctx.db.query("groups").collect()).filter((group) =>
    group.members.some((member) => member.userId === user._id)
  );
  const result = [];

  for (const group of groups) {
    const members = [];

    for (const member of group.members) {
      const memberUser = await ctx.db.get(member.userId);
      if (memberUser) {
        members.push({
          ...formatUser(memberUser),
          role: member.role,
        });
      }
    }

    result.push({
      groupId: group._id,
      name: group.name,
      description: group.description ?? "",
      memberCount: group.members.length,
      members,
    });
  }

  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

function formatUser(user) {
  return {
    userId: user._id,
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
  };
}

function isExpenseInvolvingUser(expense, userId) {
  return (
    expense.paidByUserId === userId ||
    expense.splits.some((split) => split.userId === userId)
  );
}

async function getCachedUser(ctx, cache, userId) {
  if (!cache.has(userId)) {
    cache.set(userId, await ctx.db.get(userId));
  }

  return cache.get(userId);
}

async function getCachedGroup(ctx, cache, groupId) {
  if (!cache.has(groupId)) {
    cache.set(groupId, await ctx.db.get(groupId));
  }

  return cache.get(groupId);
}

function dedupeById(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    if (seen.has(item._id)) continue;
    seen.add(item._id);
    result.push(item);
  }

  return result;
}

function clampLimit(value, fallback, max) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(number), max);
}
