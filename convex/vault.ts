import { internalMutation, internalQuery } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";

const QUOTA_BYTES = 500_000_000;
const MAX_FILE_BYTES = 50_000_000;

async function storageSummary(ctx: QueryCtx, userId: string) {
  const account = await ctx.db.query("vault_storage")
    .withIndex("by_user", q => q.eq("user_id", userId)).unique();
  const used = account?.used_bytes ?? 0;
  return {
    used_bytes: used,
    quota_bytes: QUOTA_BYTES,
    available_bytes: Math.max(0, QUOTA_BYTES - used),
    max_file_bytes: MAX_FILE_BYTES,
    file_count: account?.file_count ?? 0,
  };
}

export const addFile = internalMutation({
  args: {
    file_id: v.string(),
    user_id: v.string(),
    storage_path: v.string(),
    file_name: v.string(),
    mime_type: v.string(),
    size_bytes: v.number(),
    sha256: v.string(),
    tags: v.array(v.string()),
    created_at: v.string(),
  },
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.size_bytes) || args.size_bytes < 0 || args.size_bytes > MAX_FILE_BYTES) {
      throw new ConvexError("FILE_TOO_LARGE");
    }
    const existing = await ctx.db.query("vault_files")
      .withIndex("by_user_file", q => q.eq("user_id", args.user_id).eq("file_id", args.file_id))
      .unique();
    if (existing) {
      if (existing.sha256 !== args.sha256 || existing.size_bytes !== args.size_bytes) {
        throw new ConvexError("FILE_CONFLICT");
      }
      return existing;
    }
    const account = await ctx.db.query("vault_storage")
      .withIndex("by_user", q => q.eq("user_id", args.user_id)).unique();
    const used = account?.used_bytes ?? 0;
    if (used + args.size_bytes > QUOTA_BYTES) {
      throw new ConvexError("QUOTA_EXCEEDED");
    }
    const id = await ctx.db.insert("vault_files", args);
    if (account) {
      await ctx.db.patch(account._id, { used_bytes: used + args.size_bytes, file_count: account.file_count + 1 });
    } else {
      await ctx.db.insert("vault_storage", { user_id: args.user_id, used_bytes: args.size_bytes, file_count: 1 });
    }
    return await ctx.db.get(id);
  },
});

export const getFile = internalQuery({
  args: { user_id: v.string(), file_id: v.string() },
  handler: async (ctx, args) => ctx.db.query("vault_files")
    .withIndex("by_user_file", q => q.eq("user_id", args.user_id).eq("file_id", args.file_id))
    .unique(),
});

export const listFiles = internalQuery({
  args: { user_id: v.string(), limit: v.number(), search: v.string(), file_type: v.string() },
  handler: async (ctx, args) => {
    const search = args.search.toLowerCase();
    const limit = Math.max(1, Math.min(500, Math.floor(args.limit)));
    const files = [];
    for await (const file of ctx.db.query("vault_files")
      .withIndex("by_user_created", q => q.eq("user_id", args.user_id)).order("desc")) {
      if (search && !file.file_name.toLowerCase().includes(search)) continue;
      if (args.file_type !== "all" && file.mime_type.split("/")[0] !== args.file_type) continue;
      files.push(file);
      if (files.length === limit) break;
    }
    return { files, storage: await storageSummary(ctx, args.user_id) };
  },
});

export const getStorage = internalQuery({
  args: { user_id: v.string() },
  handler: async (ctx, args) => storageSummary(ctx, args.user_id),
});

export const removeFile = internalMutation({
  args: { user_id: v.string(), file_id: v.string() },
  handler: async (ctx, args) => {
    const file = await ctx.db.query("vault_files")
      .withIndex("by_user_file", q => q.eq("user_id", args.user_id).eq("file_id", args.file_id))
      .unique();
    if (!file) return;
    const account = await ctx.db.query("vault_storage")
      .withIndex("by_user", q => q.eq("user_id", args.user_id)).unique();
    if (!account || account.used_bytes < file.size_bytes || account.file_count < 1) {
      throw new ConvexError("STORAGE_ACCOUNT_INVALID");
    }
    await ctx.db.delete(file._id);
    if (account.file_count === 1) {
      await ctx.db.delete(account._id);
    } else {
      await ctx.db.patch(account._id, {
        used_bytes: account.used_bytes - file.size_bytes,
        file_count: account.file_count - 1,
      });
    }
  },
});
