import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as config from "../config.js";
import * as directTools from "../direct-tools.js";
import * as init from "../init.js";
import * as metadataCache from "../metadata-cache.js";
import mcpAdapter from "../index.ts";

function createMocks() {
  return {
    initializeMcp: spyOn(init, "initializeMcp"),
    updateStatusBar: spyOn(init, "updateStatusBar").mockImplementation(() => {}),
    flushMetadataCache: spyOn(init, "flushMetadataCache").mockImplementation(() => {}),
    loadMcpConfig: spyOn(config, "loadMcpConfig").mockReturnValue({ mcpServers: {} }),
    loadMetadataCache: spyOn(metadataCache, "loadMetadataCache").mockReturnValue(null),
    buildProxyDescription: spyOn(directTools, "buildProxyDescription").mockReturnValue("MCP gateway"),
    resolveDirectTools: spyOn(directTools, "resolveDirectTools").mockReturnValue([]),
  };
}

let mocks: ReturnType<typeof createMocks>;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createState() {
  return {
    manager: { getAllConnections: () => new Map() },
    lifecycle: { gracefulShutdown: mock().mockResolvedValue(undefined) },
    toolMetadata: new Map(),
    config: { mcpServers: {} },
    failureTracker: new Map(),
    uiResourceHandler: {},
    consentManager: {},
    uiServer: null,
    completedUiSessions: [],
    openBrowser: mock(),
  } as any;
}

function createPi() {
  const handlers = new Map<string, (...args: any[]) => unknown>();
  return {
    handlers,
    api: {
      registerTool: mock(),
      registerFlag: mock(),
      registerCommand: mock(),
      on: mock((event: string, handler: (...args: any[]) => unknown) => {
        handlers.set(event, handler);
      }),
      getAllTools: mock(() => []),
    } as any,
  };
}

describe("mcpAdapter session lifecycle", () => {
  beforeEach(() => {
    mocks = createMocks();
  });

  afterEach(() => {
    mock.restore();
  });

  it("starts a replacement init immediately and shuts down stale init results", async () => {
    const first = createDeferred<any>();
    const second = createDeferred<any>();
    mocks.initializeMcp
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { api, handlers } = createPi();
    mcpAdapter(api);

    const sessionStart = handlers.get("session_start");
    expect(sessionStart).toBeTypeOf("function");

    await sessionStart?.({}, {});
    expect(mocks.initializeMcp).toHaveBeenCalledTimes(1);

    await sessionStart?.({}, {});
    expect(mocks.initializeMcp).toHaveBeenCalledTimes(2);

    const activeState = createState();
    second.resolve(activeState);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.updateStatusBar).toHaveBeenCalledWith(activeState);
    expect(activeState.lifecycle.gracefulShutdown).not.toHaveBeenCalled();

    const staleState = createState();
    first.resolve(staleState);
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.updateStatusBar).not.toHaveBeenCalledWith(staleState);
    expect(mocks.flushMetadataCache).toHaveBeenCalledWith(staleState, undefined);
    expect(staleState.lifecycle.gracefulShutdown).toHaveBeenCalledTimes(1);
  });

  it("logs initialization errors when updateStatusBar throws", async () => {
    const state = createState();
    mocks.initializeMcp.mockResolvedValue(state);
    mocks.updateStatusBar.mockImplementation(() => {
      throw new Error("status boom");
    });

    const consoleError = spyOn(console, "error").mockImplementation(() => {});

    try {
      const { api, handlers } = createPi();
      mcpAdapter(api);

      const sessionStart = handlers.get("session_start");
      expect(sessionStart).toBeTypeOf("function");

      await sessionStart?.({}, {});
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setImmediate(resolve));

      expect(consoleError).toHaveBeenCalledWith("MCP initialization failed:", expect.any(Error));
    } finally {
      consoleError.mockRestore();
    }
  });

});
