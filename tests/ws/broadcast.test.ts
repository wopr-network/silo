import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "../../src/repositories/drizzle/schema.js";
import { DrizzleEntityRepository } from "../../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../../src/repositories/drizzle/flow.repo.js";
import { DrizzleInvocationRepository } from "../../src/repositories/drizzle/invocation.repo.js";
import { DrizzleGateRepository } from "../../src/repositories/drizzle/gate.repo.js";
import { DrizzleTransitionLogRepository } from "../../src/repositories/drizzle/transition-log.repo.js";
import { Engine } from "../../src/engine/engine.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";
import { WebSocketBroadcaster } from "../../src/ws/broadcast.js";
import type { EngineEvent } from "../../src/engine/event-types.js";

const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;

function makeEngine() {
	const sqlite = new Database(":memory:");
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	const entityRepo = new DrizzleEntityRepository(db);
	const flowRepo = new DrizzleFlowRepository(db);
	const invocationRepo = new DrizzleInvocationRepository(db);
	const gateRepo = new DrizzleGateRepository(db);
	const transitionLogRepo = new DrizzleTransitionLogRepository(db);
	const eventEmitter = new EventEmitter();
	const engine = new Engine({
		entityRepo,
		flowRepo,
		invocationRepo,
		gateRepo,
		transitionLogRepo,
		adapters: new Map(),
		eventEmitter,
	});
	return { engine, eventEmitter, sqlite };
}

function connectWs(port: number, token?: string): Promise<WebSocket> {
	const url = token ? `ws://127.0.0.1:${port}/ws?token=${token}` : `ws://127.0.0.1:${port}/ws`;
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(url);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
	});
}

describe("WebSocketBroadcaster", () => {
	let server: http.Server;
	let broadcaster: WebSocketBroadcaster;
	let port: number;
	let closers: Array<() => void>;
	const ADMIN_TOKEN = "test-admin-token-1948";

	beforeEach(async () => {
		closers = [];
		const { engine } = makeEngine();
		server = http.createServer();
		broadcaster = new WebSocketBroadcaster({ server, engine, adminToken: ADMIN_TOKEN });
		port = await new Promise<number>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				resolve((server.address() as { port: number }).port);
			});
		});
	});

	afterEach(async () => {
		for (const close of closers) close();
		broadcaster.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("rejects connection without token", async () => {
		await expect(connectWs(port)).rejects.toThrow();
	});

	it("rejects connection with wrong token", async () => {
		await expect(connectWs(port, "wrong-token")).rejects.toThrow();
	});

	it("accepts connection with valid query token", async () => {
		const ws = await connectWs(port, ADMIN_TOKEN);
		closers.push(() => ws.close());
		expect(ws.readyState).toBe(WebSocket.OPEN);
	});

	it("sends snapshot on connect", async () => {
		const ws = await connectWs(port, ADMIN_TOKEN);
		closers.push(() => ws.close());
		const msg = await new Promise<Record<string, unknown>>((resolve) => {
			ws.on("message", (data) => resolve(JSON.parse(data.toString())));
		});
		expect(msg.type).toBe("snapshot");
		expect(msg.payload).toBeDefined();
		expect(msg.timestamp).toBeDefined();
	});

	it("broadcasts engine events to connected clients", async () => {
		const ws = await connectWs(port, ADMIN_TOKEN);
		closers.push(() => ws.close());
		// Consume snapshot first
		await new Promise<void>((resolve) => {
			ws.on("message", () => resolve());
		});

		const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
			ws.on("message", (data) => resolve(JSON.parse(data.toString())));
		});

		const event: EngineEvent = {
			type: "entity.created",
			entityId: "test-entity-1",
			flowId: "test-flow-1",
			payload: { refs: null },
			emittedAt: new Date(),
		};
		await broadcaster.emit(event);

		const msg = await eventPromise;
		expect(msg.type).toBe("entity.created");
		expect((msg.payload as Record<string, unknown>).entityId).toBe("test-entity-1");
	});

	it("does not send to disconnected clients", async () => {
		const ws = await connectWs(port, ADMIN_TOKEN);
		// Consume snapshot
		await new Promise<void>((resolve) => {
			ws.on("message", () => resolve());
		});
		// Close and wait for server-side close acknowledgement
		await new Promise<void>((resolve) => {
			ws.on("close", () => resolve());
			ws.close();
		});
		// Small delay to let wss.clients update
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Should not throw
		await broadcaster.emit({
			type: "entity.created",
			entityId: "e1",
			flowId: "f1",
			payload: { refs: null },
			emittedAt: new Date(),
		});
		expect(broadcaster.clientCount).toBe(0);
	});
});
