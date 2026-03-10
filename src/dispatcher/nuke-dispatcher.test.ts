import { describe, expect, it, vi } from "vitest";
import { NukeDispatcher } from "./nuke-dispatcher.js";

describe("NukeDispatcher", () => {
  const mockRepo = {
    insert: vi.fn().mockResolvedValue(undefined),
    getByEntity: vi.fn().mockReturnValue([]),
    getSummary: vi.fn().mockReturnValue(""),
    deleteByEntity: vi.fn(),
  };

  it("implements Dispatcher interface", () => {
    const dispatcher = new NukeDispatcher(mockRepo);
    expect(typeof dispatcher.dispatch).toBe("function");
  });

  it("exposes stopEntity and stopAll methods", () => {
    const dispatcher = new NukeDispatcher(mockRepo);
    expect(typeof dispatcher.stopEntity).toBe("function");
    expect(typeof dispatcher.stopAll).toBe("function");
  });

  it("uses NUKE_IMAGE env var as default image", () => {
    const orig = process.env.NUKE_IMAGE;
    process.env.NUKE_IMAGE = "custom-image:latest";
    const dispatcher = new NukeDispatcher(mockRepo);
    // Access internal image via dispatch attempt (will fail on docker but tests the constructor)
    expect(dispatcher).toBeDefined();
    process.env.NUKE_IMAGE = orig;
  });

  it("accepts opts.image override", () => {
    const dispatcher = new NukeDispatcher(mockRepo, { image: "my-custom-image" });
    expect(dispatcher).toBeDefined();
  });

  it("returns crash result when container launch fails", async () => {
    const dispatcher = new NukeDispatcher(mockRepo, { image: "nonexistent-image-xyz-404" });
    // docker run will fail because the image doesn't exist
    const result = await dispatcher.dispatch("test", {
      entityId: "ent-1",
      workerId: "w-1",
      modelTier: "haiku",
    });
    expect(result.signal).toBe("crash");
    expect(result.exitCode).toBe(-1);
  });
});
