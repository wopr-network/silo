import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
import { DrizzleEventRepository } from "../../src/repositories/drizzle/event.repo.js";
import { Engine } from "../../src/engine/engine.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";
import { WebSocketBroadcaster } from "../../src/ws/broadcast.js";
import { createHttpServer } from "../../src/api/server.js";

const MIGRATIONS_FOLDER = new URL("../../drizzle", import.meta.url).pathname;
const ADMIN_TOKEN = "integration-test-token";

describe("WebSocket integration with HTTP server", () => {
	let broadcaster: WebSocketBroadcaster;
	let port: number;
	let engine: Engine;
	let eventEmitter: EventEmitter;
	let sqlite: Database.Database;
	let server: ReturnType<typeof createHttpServer>;

	beforeEach(async () => {
		sqlite = new Database(":memory:");
		sqlite.pragma("journal_mode = WAL");
		sqlite.pragma("foreign_keys = ON");
		const db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

		const entityRepo = new DrizzleEntityRepository(db);
		const flowRepo = new DrizzleFlowRepository(db);
		const invocationRepo = new DrizzleInvocationRepository(db);
		const gateRepo = new DrizzleGateRepository(db);
		const transitionLogRepo = new DrizzleTransitionLogRepository(db);
		const eventRepo = new DrizzleEventRepository(db);
		eventEmitter = new EventEmitter();

		engine = new Engine({
			entityRepo,
			flowRepo,
			invocationRepo,
			gateRepo,
			transitionLogRepo,
			adapters: new Map(),
			eventEmitter,
		});

		const mcpDeps = {
			entities: entityRepo,
			flows: flowRepo,
			invocations: invocationRepo,
			gates: gateRepo,
			transitions: transitionLogRepo,
			eventRepo,
			engine,
		};

		server = createHttpServer({
			engine,
			mcpDeps,
			adminToken: ADMIN_TOKEN,
			workerToken: "worker-tok",
		});

		broadcaster = new WebSocketBroadcaster({ server, engine, adminToken: ADMIN_TOKEN });
		eventEmitter.register(broadcaster);

		port = await new Promise<number>((resolve) => {
			server.listen(0, "127.0.0.1", () => {
				resolve((server.address() as { port: number }).port);
			});
		});
	});

	afterEach(async () => {
		broadcaster.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		sqlite.close();
	});

	it("HTTP routes still work with WS attached", async () => {
		const res = await fetch(`http://127.0.0.1:${port}/api/status`);
		expect(res.status).toBe(200);
	});

	it("WS connects via header auth", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});
		const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
			ws.on("message", (data) => resolve(JSON.parse(data.toString())));
			ws.on("error", reject);
		});
		expect(msg.type).toBe("snapshot");
		ws.close();
	});

	it("engine events reach WS clients through eventEmitter", async () => {
		const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${ADMIN_TOKEN}`);
		// Consume snapshot
		await new Promise<void>((resolve, reject) => {
			ws.on("open", () => {});
			ws.on("message", () => resolve());
			ws.on("error", reject);
		});

		const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
			ws.on("message", (data) => resolve(JSON.parse(data.toString())));
		});

		await eventEmitter.emit({
			type: "gate.passed",
			entityId: "ent-1",
			gateId: "gate-1",
			emittedAt: new Date(),
		});

		const msg = await eventPromise;
		expect(msg.type).toBe("gate.passed");
		expect((msg.payload as Record<string, unknown>).entityId).toBe("ent-1");
		ws.close();
	});
});
