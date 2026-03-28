import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function toSafeInt(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(Math.floor(value), 0);
}

function zeroUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

export const recordTokenUsage = mutation({
  args: {
    user_id: v.string(),
    event_key: v.string(),
    conversation_id: v.optional(v.string()),
    message_id: v.optional(v.string()),
    day_key: v.string(),
    window_key: v.string(),
    plan_type: v.string(),
    limit_interval: v.string(),
    input_tokens: v.number(),
    output_tokens: v.number(),
    total_tokens: v.number(),
    window_start_ms: v.optional(v.number()),
    window_end_ms: v.optional(v.number()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("usage_events")
      .withIndex("by_event_key", (q) => q.eq("event_key", args.event_key))
      .first();

    if (existing) {
      return {
        ok: true,
        deduplicated: true,
        event_id: existing._id,
      };
    }

    const inputTokens = toSafeInt(args.input_tokens);
    const outputTokens = toSafeInt(args.output_tokens);
    const totalTokens = Math.max(toSafeInt(args.total_tokens), inputTokens + outputTokens);
    const now = Date.now();

    const eventId = await ctx.db.insert("usage_events", {
      user_id: args.user_id,
      event_key: args.event_key,
      conversation_id: args.conversation_id,
      message_id: args.message_id,
      day_key: args.day_key,
      window_key: args.window_key,
      plan_type: args.plan_type,
      limit_interval: args.limit_interval,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      window_start_ms: args.window_start_ms,
      window_end_ms: args.window_end_ms,
      source: args.source,
      created_at_ms: now,
    });

    const existingDaily = await ctx.db
      .query("usage_daily")
      .withIndex("by_user_day_key", (q) =>
        q.eq("user_id", args.user_id).eq("day_key", args.day_key),
      )
      .first();

    if (existingDaily) {
      await ctx.db.patch(existingDaily._id, {
        input_tokens: toSafeInt(existingDaily.input_tokens + inputTokens),
        output_tokens: toSafeInt(existingDaily.output_tokens + outputTokens),
        total_tokens: toSafeInt(existingDaily.total_tokens + totalTokens),
        last_event_at_ms: now,
        updated_at_ms: now,
      });
    } else {
      await ctx.db.insert("usage_daily", {
        user_id: args.user_id,
        day_key: args.day_key,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        first_event_at_ms: now,
        last_event_at_ms: now,
        created_at_ms: now,
        updated_at_ms: now,
      });
    }

    const existingWindow = await ctx.db
      .query("usage_windows")
      .withIndex("by_user_window_key", (q) =>
        q.eq("user_id", args.user_id).eq("window_key", args.window_key),
      )
      .first();

    if (existingWindow) {
      await ctx.db.patch(existingWindow._id, {
        plan_type: args.plan_type,
        limit_interval: args.limit_interval,
        input_tokens: toSafeInt(existingWindow.input_tokens + inputTokens),
        output_tokens: toSafeInt(existingWindow.output_tokens + outputTokens),
        total_tokens: toSafeInt(existingWindow.total_tokens + totalTokens),
        window_start_ms: args.window_start_ms,
        window_end_ms: args.window_end_ms,
        updated_at_ms: now,
      });
    } else {
      await ctx.db.insert("usage_windows", {
        user_id: args.user_id,
        window_key: args.window_key,
        plan_type: args.plan_type,
        limit_interval: args.limit_interval,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        window_start_ms: args.window_start_ms,
        window_end_ms: args.window_end_ms,
        created_at_ms: now,
        updated_at_ms: now,
      });
    }

    return {
      ok: true,
      deduplicated: false,
      event_id: eventId,
    };
  },
});

export const getWindowUsage = query({
  args: {
    user_id: v.string(),
    window_key: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("usage_windows")
      .withIndex("by_user_window_key", (q) =>
        q.eq("user_id", args.user_id).eq("window_key", args.window_key),
      )
      .first();

    if (!row) {
      return {
        ...zeroUsage(),
        user_id: args.user_id,
        window_key: args.window_key,
        usage_source: "convex_window",
      };
    }

    return {
      ...row,
      usage_source: "convex_window",
    };
  },
});

export const getDailyUsageForUser = query({
  args: {
    user_id: v.string(),
    day_key: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.day_key) {
      const row = await ctx.db
        .query("usage_daily")
        .withIndex("by_user_day_key", (q) =>
          q.eq("user_id", args.user_id).eq("day_key", args.day_key!),
        )
        .first();
      return row ? [row] : [];
    }

    const limit = Math.max(1, Math.min(toSafeInt(args.limit ?? 30), 365));
    const rows = await ctx.db
      .query("usage_daily")
      .withIndex("by_user_updated_at", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(limit);
    return rows;
  },
});

export const getUsageEventsForUser = query({
  args: {
    user_id: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(toSafeInt(args.limit ?? 2000), 10000));
    const rows = await ctx.db
      .query("usage_events")
      .withIndex("by_user_created_at", (q) => q.eq("user_id", args.user_id))
      .order("desc")
      .take(limit);
    return rows;
  },
});

export const getDailyUsageByDate = query({
  args: {
    day_key: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(toSafeInt(args.limit ?? 500), 5000));
    const rows = await ctx.db
      .query("usage_daily")
      .withIndex("by_day_key", (q) => q.eq("day_key", args.day_key))
      .take(limit);
    return rows;
  },
});

export const getLifetimeUsage = query({
  args: {
    user_id: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("usage_windows")
      .withIndex("by_user_updated_at", (q) => q.eq("user_id", args.user_id))
      .collect();

    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let updatedAt = 0;
    for (const row of rows) {
      inputTokens += toSafeInt(row.input_tokens);
      outputTokens += toSafeInt(row.output_tokens);
      totalTokens += toSafeInt(row.total_tokens);
      updatedAt = Math.max(updatedAt, toSafeInt(row.updated_at_ms));
    }
    return {
      user_id: args.user_id,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      updated_at_ms: updatedAt || null,
      window_count: rows.length,
      usage_source: "convex_lifetime",
    };
  },
});

export const upsertSubscriptionSnapshot = mutation({
  args: {
    user_id: v.string(),
    plan_type: v.string(),
    subscription_status: v.string(),
    current_period_end_iso: v.optional(v.string()),
    current_period_end_ms: v.optional(v.number()),
    razorpay_customer_id: v.optional(v.string()),
    razorpay_subscription_id: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("user_subscription_snapshots")
      .withIndex("by_user_id", (q) => q.eq("user_id", args.user_id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        plan_type: args.plan_type,
        subscription_status: args.subscription_status,
        current_period_end_iso: args.current_period_end_iso,
        current_period_end_ms: args.current_period_end_ms,
        razorpay_customer_id: args.razorpay_customer_id,
        razorpay_subscription_id: args.razorpay_subscription_id,
        updated_at_ms: now,
      });
      return { ok: true, updated: true, id: existing._id };
    }

    const id = await ctx.db.insert("user_subscription_snapshots", {
      user_id: args.user_id,
      plan_type: args.plan_type,
      subscription_status: args.subscription_status,
      current_period_end_iso: args.current_period_end_iso,
      current_period_end_ms: args.current_period_end_ms,
      razorpay_customer_id: args.razorpay_customer_id,
      razorpay_subscription_id: args.razorpay_subscription_id,
      created_at_ms: now,
      updated_at_ms: now,
    });
    return { ok: true, updated: false, id };
  },
});
