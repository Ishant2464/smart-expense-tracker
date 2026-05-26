import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    await ctx.runQuery(internal.users.getCurrentUser);
    return await ctx.storage.generateUploadUrl();
  },
});