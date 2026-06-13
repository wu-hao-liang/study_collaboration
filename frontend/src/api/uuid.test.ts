import { afterEach, describe, expect, it, vi } from "vitest";

import { createUuid } from "./uuid";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("createUuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the native implementation when available", () => {
    const randomUUID = vi.fn(() => "123e4567-e89b-42d3-a456-426614174000");
    vi.stubGlobal("crypto", { randomUUID });

    expect(createUuid()).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("uses random bytes when randomUUID is unavailable", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0x2a);
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    expect(createUuid()).toMatch(UUID_V4_PATTERN);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("still creates a UUID when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);

    expect(createUuid()).toMatch(UUID_V4_PATTERN);
  });
});
