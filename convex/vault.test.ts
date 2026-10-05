import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  "./vault.ts": () => import("./vault"),
  "./_generated/server.js": () => import("./_generated/server"),
};
const add = makeFunctionReference<"mutation">("vault:addFile");
const remove = makeFunctionReference<"mutation">("vault:removeFile");
const get = makeFunctionReference<"query">("vault:getFile");
const list = makeFunctionReference<"query">("vault:listFiles");
const storage = makeFunctionReference<"query">("vault:getStorage");

function file(id: string, bytes: number, user = "user-a") {
  return {
    file_id: id, user_id: user, storage_path: `${user}/${id}`,
    file_name: `${id}.txt`, mime_type: "text/plain", size_bytes: bytes,
    sha256: id, tags: [], created_at: "2026-10-06T00:00:00Z",
  };
}

describe("vault metadata", () => {
  test("counts actual bytes, accepts exactly 500 MB and rejects excess", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 10; i++) await t.mutation(add, file(`file-${i}`, 50_000_000));
    expect(await t.query(storage, { user_id: "user-a" })).toMatchObject({ used_bytes: 500_000_000, file_count: 10, available_bytes: 0 });
    await expect(t.mutation(add, file("excess", 1))).rejects.toThrow("QUOTA_EXCEEDED");
    await expect(t.mutation(add, file("large", 50_000_001, "user-b"))).rejects.toThrow("FILE_TOO_LARGE");
    await expect(t.mutation(add, file("negative", -1))).rejects.toThrow();
    await expect(t.mutation(add, file("fractional", 0.5))).rejects.toThrow();
  });

  test("concurrent uploads cannot exceed the quota", async () => {
    const t = convexTest(schema, modules);
    for (let i = 0; i < 9; i++) await t.mutation(add, file(`existing-${i}`, 50_000_000));
    const results = await Promise.allSettled([
      t.mutation(add, file("first", 50_000_000)), t.mutation(add, file("second", 50_000_000)),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await t.query(storage, { user_id: "user-a" })).toMatchObject({ used_bytes: 500_000_000, file_count: 10 });
  });

  test("repeated writes/deletes do not double charge or free space twice", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(add, file("same", 10));
    await t.mutation(add, file("same", 10));
    expect(await t.query(storage, { user_id: "user-a" })).toMatchObject({ used_bytes: 10, file_count: 1 });
    await expect(t.mutation(add, { ...file("same", 10), sha256: "different" })).rejects.toThrow("FILE_CONFLICT");
    await t.mutation(remove, { user_id: "user-a", file_id: "same" });
    await t.mutation(remove, { user_id: "user-a", file_id: "same" });
    expect(await t.query(storage, { user_id: "user-a" })).toMatchObject({ used_bytes: 0, file_count: 0 });
  });

  test("list/read/delete remain scoped to the owner", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(add, file("private", 20));
    expect(await t.query(get, { user_id: "user-b", file_id: "private" })).toBeNull();
    await t.mutation(remove, { user_id: "user-b", file_id: "private" });
    expect(await t.query(list, { user_id: "user-b", limit: 100, search: "", file_type: "all" })).toMatchObject({ files: [] });
    expect(await t.query(list, { user_id: "user-a", limit: 1, search: "PRIVATE", file_type: "text" })).toMatchObject({ files: [{ file_id: "private" }], storage: { used_bytes: 20 } });
  });
});
