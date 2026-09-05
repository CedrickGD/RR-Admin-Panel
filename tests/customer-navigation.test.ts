import { describe, expect, it } from "vitest";
import { customerActionUrl, customerReturnUrl } from "../src/utils/customerNavigation";

describe("customer return navigation", () => {
  it("restores the same customer, source page and selected tab", () => {
    const source = new URL(
      "https://admin.example/?customer=alice%2Bpc&customerBy=install_id#/workers",
    );
    const destination = customerActionUrl(source, "activity");
    expect(destination.hash).toBe("#/licenses");
    expect(destination.searchParams.has("customer")).toBe(false);
    const back = customerReturnUrl(destination)!;
    expect(back.hash).toBe("#/workers");
    expect(back.searchParams.get("customer")).toBe("alice+pc");
    expect(back.searchParams.get("customerTab")).toBe("activity");
    expect(source.searchParams.has("customerTab")).toBe(false);
  });
  it.each([
    "https://outside.example/?customer=a&customerBy=hwid",
    "/unrelated?customer=a&customerBy=hwid",
    "/?customer=a&customerBy=invalid",
    "/?customerBy=hwid",
  ])("rejects an invalid return destination: %s", (value) => {
    const current = new URL("https://admin.example/#/licenses");
    current.searchParams.set("customerReturn", value);
    expect(customerReturnUrl(current)).toBeNull();
  });
});
