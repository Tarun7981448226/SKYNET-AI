import { describe, expect, it } from "vitest";

import { urlBase64ToUint8Array } from "./subscribe";

describe("urlBase64ToUint8Array", () => {
  it("decodes a base64url string with no padding needed", () => {
    // "hi" -> base64 "aGk=" -> base64url "aGk"
    const result = urlBase64ToUint8Array("aGk");
    expect(Array.from(result)).toEqual([104, 105]);
  });

  it("decodes a base64url string that needs padding restored", () => {
    // "hello" -> base64 "aGVsbG8=" -> base64url "aGVsbG8"
    const result = urlBase64ToUint8Array("aGVsbG8");
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]);
  });

  it("converts - and _ back to + and / before decoding", () => {
    // bytes [251, 255, 191] base64-encode to "+/+/" — verify the URL-safe
    // substitution round-trips correctly.
    const result = urlBase64ToUint8Array("-_-_");
    expect(Array.from(result)).toEqual([251, 255, 191]);
  });
});
