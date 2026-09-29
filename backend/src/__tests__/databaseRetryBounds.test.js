import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDatabaseRetry } from "../utils/databaseRetry.js";

const transient = () => {
  const error = new Error("database is busy");
  error.code = "SQLITE_BUSY";
  return error;
};
const fatal = () => {
  const error = new Error("unique violation");
  error.code = "SQLITE_CONSTRAINT";
  return error;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.resetModules();
});

// Attach the rejection handler BEFORE advancing timers so no rejection is
// ever unhandled while the fake clock is flushed.
async function expectTransientFailure(operation, options) {
  const pending = withDatabaseRetry(operation, options);
  const check = expect(pending).rejects.toThrow("database is busy");
  await vi.runAllTimersAsync();
  await check;
}

describe("withDatabaseRetry bounded inputs (synthetic, fake timers)", () => {
  it("falls back to the default for NaN/Infinity/malformed strings", async () => {
    for (const attempts of [NaN, Infinity, -Infinity, "abc", "  ", ""]) {
      const operation = vi.fn().mockRejectedValue(transient());
      await expectTransientFailure(operation, { attempts, baseDelayMs: 1 });
      expect(operation).toHaveBeenCalledTimes(3);
    }
  });

  it("caps huge finite attempts at 10", async () => {
    const operation = vi.fn().mockRejectedValue(transient());
    await expectTransientFailure(operation, {
      attempts: 1e9,
      baseDelayMs: 1,
    });
    expect(operation).toHaveBeenCalledTimes(10);
  });

  it("accepts numeric strings and floors fractional attempts", async () => {
    const fromString = vi.fn().mockRejectedValue(transient());
    await expectTransientFailure(fromString, { attempts: "4", baseDelayMs: 1 });
    expect(fromString).toHaveBeenCalledTimes(4);

    const fractional = vi.fn().mockRejectedValue(transient());
    await expectTransientFailure(fractional, { attempts: 2.7, baseDelayMs: 1 });
    expect(fractional).toHaveBeenCalledTimes(2);
  });

  it("always runs the operation at least once", async () => {
    for (const attempts of [0, -3, "0", 0.4]) {
      const operation = vi.fn().mockRejectedValue(transient());
      await expectTransientFailure(operation, { attempts, baseDelayMs: 1 });
      expect(operation).toHaveBeenCalledTimes(1);
    }
  });

  it("falls back for unsupported types without invoking user coercion", async () => {
    const sneaky = {
      valueOf: () => {
        throw new Error("coercion invoked");
      },
    };
    const viaObject = vi.fn().mockRejectedValue(transient());
    await expectTransientFailure(viaObject, {
      attempts: sneaky,
      baseDelayMs: 1,
    });
    expect(viaObject).toHaveBeenCalledTimes(3);

    // Number(Symbol) would throw; restricted coercion must not attempt it.
    const viaSymbol = vi.fn().mockRejectedValue(transient());
    await expectTransientFailure(viaSymbol, {
      attempts: Symbol("attempts"),
      baseDelayMs: 1,
    });
    expect(viaSymbol).toHaveBeenCalledTimes(3);

    const viaBoolean = vi.fn().mockRejectedValue(transient());
    await expectTransientFailure(viaBoolean, { attempts: true, baseDelayMs: 1 });
    expect(viaBoolean).toHaveBeenCalledTimes(3);
  });

  it("rejects with the terminal original error identity", async () => {
    const terminal = transient();
    const operation = vi.fn().mockRejectedValue(terminal);
    const pending = withDatabaseRetry(operation, {
      attempts: 3,
      baseDelayMs: 1,
    });
    const check = expect(pending).rejects.toBe(terminal);
    await vi.runAllTimersAsync();
    await check;
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry or wait for a non-transient error", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const mark = setTimeoutSpy.mock.calls.length;
    const operation = vi.fn().mockRejectedValue(fatal());
    await expect(
      withDatabaseRetry(operation, { attempts: 5, baseDelayMs: 100 }),
    ).rejects.toThrow("unique violation");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy.mock.calls.length).toBe(mark);
  });

  it("caps every sleep at 5000ms including jitter", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9999);
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const mark = setTimeoutSpy.mock.calls.length;
    const operation = vi.fn().mockRejectedValue(transient());
    const pending = withDatabaseRetry(operation, {
      attempts: 10,
      baseDelayMs: 5000,
    });
    const check = expect(pending).rejects.toThrow("database is busy");
    await vi.runAllTimersAsync();
    await check;
    expect(operation).toHaveBeenCalledTimes(10);
    const sleeps = setTimeoutSpy.mock.calls
      .slice(mark)
      .map((call) => call[1]);
    expect(sleeps).toHaveLength(9);
    expect(Math.max(...sleeps)).toBeLessThanOrEqual(5000);
  });

  it("retries with zero delay without jitter or a wait timer", async () => {
    const randomSpy = vi.spyOn(Math, "random");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const mark = setTimeoutSpy.mock.calls.length;
    const operation = vi
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValue("recovered");
    await expect(
      withDatabaseRetry(operation, { attempts: 3, baseDelayMs: 0 }),
    ).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(randomSpy).not.toHaveBeenCalled();
    expect(setTimeoutSpy.mock.calls.length).toBe(mark);
  });

  it("treats blank env values as unset defaults", async () => {
    vi.stubEnv("DATABASE_READ_RETRY_ATTEMPTS", "");
    vi.stubEnv("DATABASE_READ_RETRY_DELAY_MS", "");
    vi.resetModules();
    const fresh = await import("../utils/databaseRetry.js");
    const operation = vi.fn().mockRejectedValue(transient());
    const pending = fresh.withDatabaseRetry(operation);
    const check = expect(pending).rejects.toThrow("database is busy");
    await vi.runAllTimersAsync();
    await check;
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("honours numeric-string env attempts", async () => {
    vi.stubEnv("DATABASE_READ_RETRY_ATTEMPTS", "2");
    vi.stubEnv("DATABASE_READ_RETRY_DELAY_MS", "1");
    vi.resetModules();
    const fresh = await import("../utils/databaseRetry.js");
    const operation = vi.fn().mockRejectedValue(transient());
    const pending = fresh.withDatabaseRetry(operation);
    const check = expect(pending).rejects.toThrow("database is busy");
    await vi.runAllTimersAsync();
    await check;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-function operation with a clear TypeError", async () => {
    await expect(withDatabaseRetry(null)).rejects.toThrow(TypeError);
  });

  it("passes the 1-based attempt number and returns the first success", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    await expect(
      withDatabaseRetry(operation, { attempts: 3, baseDelayMs: 1 }),
    ).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledWith(1);
  });
});
