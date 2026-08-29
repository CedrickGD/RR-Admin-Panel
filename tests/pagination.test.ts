import { describe, expect, it } from "vitest";
import { paginate } from "../src/utils/pagination";

describe("paginate", () => {
  it("keeps an empty collection on a valid first page", () => {
    expect(paginate([], 99, 100)).toEqual({
      items: [],
      page: 1,
      pageCount: 1,
      pageSize: 100,
      start: 0,
      end: 0,
      total: 0,
    });
  });

  it("bounds a large directory to one render window", () => {
    const users = Array.from({ length: 1_017 }, (_, index) => index + 1);

    const first = paginate(users, 1, 100);
    const last = paginate(users, 11, 100);

    expect(first.items).toHaveLength(100);
    expect(first.items[0]).toBe(1);
    expect(first.items[99]).toBe(100);
    expect(first).toMatchObject({ page: 1, pageCount: 11, start: 1, end: 100, total: 1_017 });

    expect(last.items).toEqual(users.slice(1_000));
    expect(last).toMatchObject({ page: 11, pageCount: 11, start: 1_001, end: 1_017 });
  });

  it("clamps stale page numbers after filtering shrinks the result", () => {
    const result = paginate(["match-a", "match-b"], 8, 100);

    expect(result.page).toBe(1);
    expect(result.items).toEqual(["match-a", "match-b"]);
  });
});
