import { execFile } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NukeDispatcher } from "./nuke-dispatcher.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

const mockedExecFile = vi.mocked(execFile);

describe("NukeDispatcher", () => {
  const mockRepo = {
    insert: vi.fn().mockResolvedValue(undefined),
    getByEntity: vi.fn().mockReturnValue([]),
    getSummary: vi.fn().mockReturnValue(""),
    deleteByEntity: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  /** Make execFile call its callback with an error — short-circuits launchContainer. */
  function rejectExecFile() {
    // biome-ignore lint/suspicious/noExplicitAny: vitest mock needs to bypass overload resolution
    (mockedExecFile as any).mockImplementation(
      (_cmd: unknown, _args: unknown, cb: (err: Error | null, result?: unknown) => void) => {
        cb(new Error("mock: docker not available"));
      },
    );
  }

  it("implements Dispatcher interface", () => {
    const dispatcher = new NukeDispatcher(mockRepo);
    expect(typeof dispatcher.dispatch).toBe("function");
  });

  it("exposes stopEntity and stopAll methods", () => {
    const dispatcher = new NukeDispatcher(mockRepo);
    expect(typeof dispatcher.stopEntity).toBe("function");
    expect(typeof dispatcher.stopAll).toBe("function");
  });

  it("uses NUKE_IMAGE env var as default image", async () => {
    rejectExecFile();
    const orig = process.env.NUKE_IMAGE;
    process.env.NUKE_IMAGE = "custom-image:latest";
    try {
      const dispatcher = new NukeDispatcher(mockRepo);
      await dispatcher.dispatch("test", {
        entityId: "ent-env",
        workerId: "w-1",
        modelTier: "haiku",
      });
      // execFile is called with ("docker", [...args, image])
      const callArgs = mockedExecFile.mock.calls[0];
      expect(callArgs[0]).toBe("docker");
      const dockerArgs = callArgs[1] as string[];
      // Image is the last element of the docker run args
      expect(dockerArgs[dockerArgs.length - 1]).toBe("custom-image:latest");
    } finally {
      if (orig === undefined) {
        delete process.env.NUKE_IMAGE;
      } else {
        process.env.NUKE_IMAGE = orig;
      }
    }
  });

  it("accepts opts.image override", async () => {
    rejectExecFile();
    const dispatcher = new NukeDispatcher(mockRepo, { image: "my-custom-image" });
    await dispatcher.dispatch("test", {
      entityId: "ent-opts",
      workerId: "w-1",
      modelTier: "haiku",
    });
    const callArgs = mockedExecFile.mock.calls[0];
    expect(callArgs[0]).toBe("docker");
    const dockerArgs = callArgs[1] as string[];
    expect(dockerArgs[dockerArgs.length - 1]).toBe("my-custom-image");
  });

  it("returns crash result when container launch fails", async () => {
    rejectExecFile();
    const dispatcher = new NukeDispatcher(mockRepo, { image: "nonexistent-image-xyz-404" });
    const result = await dispatcher.dispatch("test", {
      entityId: "ent-1",
      workerId: "w-1",
      modelTier: "haiku",
    });
    expect(result.signal).toBe("crash");
    expect(result.exitCode).toBe(-1);
  });
});
