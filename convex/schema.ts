import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  usage_events: defineTable({
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
    created_at_ms: v.number(),
  })
    .index("by_event_key", ["event_key"])
    .index("by_user_created_at", ["user_id", "created_at_ms"])
    .index("by_user_day_key", ["user_id", "day_key"])
    .index("by_user_window_key", ["user_id", "window_key"]),

  usage_daily: defineTable({
    user_id: v.string(),
    day_key: v.string(),
    input_tokens: v.number(),
    output_tokens: v.number(),
    total_tokens: v.number(),
    first_event_at_ms: v.number(),
    last_event_at_ms: v.number(),
    created_at_ms: v.number(),
    updated_at_ms: v.number(),
  })
    .index("by_user_day_key", ["user_id", "day_key"])
    .index("by_day_key", ["day_key"])
    .index("by_user_updated_at", ["user_id", "updated_at_ms"]),

  usage_windows: defineTable({
    user_id: v.string(),
    window_key: v.string(),
    plan_type: v.string(),
    limit_interval: v.string(),
    input_tokens: v.number(),
    output_tokens: v.number(),
    total_tokens: v.number(),
    window_start_ms: v.optional(v.number()),
    window_end_ms: v.optional(v.number()),
    created_at_ms: v.number(),
    updated_at_ms: v.number(),
  })
    .index("by_user_window_key", ["user_id", "window_key"])
    .index("by_user_updated_at", ["user_id", "updated_at_ms"]),

  user_subscription_snapshots: defineTable({
    user_id: v.string(),
    plan_type: v.string(),
    subscription_status: v.string(),
    current_period_end_iso: v.optional(v.string()),
    current_period_end_ms: v.optional(v.number()),
    razorpay_customer_id: v.optional(v.string()),
    razorpay_subscription_id: v.optional(v.string()),
    updated_at_ms: v.number(),
    created_at_ms: v.number(),
  }).index("by_user_id", ["user_id"]),
});
