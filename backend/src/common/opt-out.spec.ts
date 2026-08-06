import { isOptOutMessage, normalizeOptOutBody } from "./opt-out";

describe("SMS opt-out detection", () => {
  it.each([
    "STOP",
    "stop",
    "  ... stop!!!  ",
    "please stop messaging me",
    "QUIT",
    "UNSUBSCRIBE",
    "REMOVE",
    "remove me",
  ])("detects the complete opt-out phrase %p", (body) => {
    expect(isOptOutMessage(body)).toBe(true);
  });

  it("uses Twilio OptOutType even when the body is unrelated", () => {
    expect(isOptOutMessage("No keyword here", "STOP")).toBe(true);
  });

  it.each([
    "unstoppable service",
    "the desktop app",
    "a rooftop showing",
    "please keep messaging me",
  ])("avoids the false positive %p", (body) => {
    expect(isOptOutMessage(body)).toBe(false);
  });

  it("normalizes surrounding punctuation and repeated whitespace", () => {
    expect(normalizeOptOutBody("  ...Please   STOP!!!  ")).toBe("PLEASE STOP");
  });
});
