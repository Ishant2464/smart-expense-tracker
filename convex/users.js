import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

export const store = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Called storeUser without authentication present");
    }

    const name = args.name || identity.name || "Anonymous";
    const email = args.email || identity.email || fallbackEmail(identity);
    const imageUrl = args.imageUrl || identity.pictureUrl;

    // Check if we've already stored this identity before.
    // Note: If you don't want to define an index right away, you can use
    // ctx.db.query("users")
    //  .filter(q => q.eq(q.field("tokenIdentifier"), identity.tokenIdentifier))
    //  .unique();
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .unique();
    if (user !== null) {
      const updates = {};
      if (user.name !== name) updates.name = name;
      if (user.email !== email) updates.email = email;
      if (user.imageUrl !== imageUrl) updates.imageUrl = imageUrl;

      if (Object.keys(updates).length > 0) {
        await ctx.db.patch(user._id, updates);
      }
      return user._id;
    }
    // If it's a new identity, create a new `User`.
    return await ctx.db.insert("users", {
      name,
      tokenIdentifier: identity.tokenIdentifier,
      email,
      imageUrl,
    });
  },
});

// Get current user
export const getCurrentUser = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier)
      )
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  },
});

// Search users by name or email (for adding participants)
export const searchUsers = query({
  args: {
    query: v.string(),
  },
  handler: async (ctx, args) => {
    // Use centralized getCurrentUser function
    const currentUser = await ctx.runQuery(internal.users.getCurrentUser);

    // Don't search if query is too short
    if (args.query.length < 2) {
      return [];
    }

    // Search by name using search index
    const nameResults = await ctx.db
      .query("users")
      .withSearchIndex("search_name", (q) => q.search("name", args.query))
      .collect();

    // Search by email using search index
    const emailResults = await ctx.db
      .query("users")
      .withSearchIndex("search_email", (q) => q.search("email", args.query))
      .collect();

    // Combine results (removing duplicates)
    const users = [
      ...nameResults,
      ...emailResults.filter(
        (email) => !nameResults.some((name) => name._id === email._id)
      ),
    ];

    // Exclude current user and format results
    return users
      .filter((user) => user._id !== currentUser._id)
      .map((user) => ({
        id: user._id,
        name: user.name,
        email: user.email,
        imageUrl: user.imageUrl,
      }));
  },
});

export const updatePhone = mutation({
  args: {
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const currentUser = await ctx.runQuery(internal.users.getCurrentUser);
    const phone = normalizePhone(args.phone);

    if (!isValidPhone(phone)) {
      throw new Error("Phone number must start with + and include at least 10 digits.");
    }

    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();

    if (existingUser && existingUser._id !== currentUser._id) {
      throw new Error("This phone number is already linked to another account.");
    }

    await ctx.db.patch(currentUser._id, { phone });

    return { success: true };
  },
});

export const removePhone = mutation({
  args: {},
  handler: async (ctx) => {
    const currentUser = await ctx.runQuery(internal.users.getCurrentUser);

    await ctx.db.patch(currentUser._id, {
      phone: undefined,
    });

    return { success: true };
  },
});

export const getUserByPhone = internalQuery({
  args: {
    phone: v.string(),
  },
  handler: async (ctx, args) => {
    const phone = normalizePhone(args.phone);

    return await ctx.db
      .query("users")
      .withIndex("by_phone", (q) => q.eq("phone", phone))
      .unique();
  },
});

function normalizePhone(phone) {
  return phone.replace(/\s+/g, "").trim();
}

function isValidPhone(phone) {
  const digitCount = phone.replace(/\D/g, "").length;
  return phone.startsWith("+") && digitCount >= 10;
}

function fallbackEmail(identity) {
  return `${identity.subject}@clerk.local`;
}
