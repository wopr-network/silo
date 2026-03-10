import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { WebSocket } from "ws";
import { serve } from "@hono/node-server";
import { createTestDb, type TestDb } from "../helpers/pg-test-db.js";
import { DrizzleEntityRepository } from "../../src/repositories/drizzle/entity.repo.js";
import { DrizzleFlowRepository } from "../../src/repositories/drizzle/flow.repo.js";
import { DrizzleInvocationRepository } from "../../src/repositories/drizzle/invocation.repo.js";
import { DrizzleGateRepository } from "../../src/repositories/drizzle/gate.repo.js";
import { DrizzleTransitionLogRepository } from "../../src/repositories/drizzle/transition-log.repo.js";
import { DrizzleEventRepository } from "../../src/repositories/drizzle/event.repo.js";
import { Engine } from "../../src/engine/engine.js";
import { EventEmitter } from "../../src/engine/event-emitter.js";
import { WebSocketBroadcaster } from "../../src/ws/broadcast.js";
import { createHonoApp } from "../../src/api/hono-server.js";

const TEST_TENANT = "test-tenant";
const ADMIN_TOKEN = "integration-test-token";

describe("WebSocket integration with HTTP server", () => {
	let db: TestDb;
	let dbClose: () => Promise<void>;
	let broadcaster: WebSocketBroadcaster;
	let port: number;
	let engine: Engine;
	let eventEmitter: EventEmitter;
	let server: http.Server;

	beforeEach(async () => {
		const res = await createTestDb();
		db = res.db;
		dbClose = res.close;

		const entityRepo = new DrizzleEntityRepository(db, TEST_TENANT);
		const flowRepo = new DrizzleFlowRepository(db, TEST_TENANT);
		const invocationRepo = new DrizzleInvocationRepository(db, TEST_TENANT);
		const gateRepo = new DrizzleGateRepository(db, TEST_TENANT);
		const transitionLogRepo = new DrizzleTransitionLogRepository(db, TEST_TENANT);
		const eventRepo = new DrizzleEventRepository(db, TEST_TENANT);
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

		const app = createHonoApp({
			engine,
			mcpDeps,
			adminToken: ADMIN_TOKEN,
			workerToken: "worker-tok",
		});

		server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as http.Server;
		await new Promise<void>((resolve) => {
			if (server.listening) resolve();
			else server.on("listening", resolve);
		});

		broadcaster = new WebSocketBroadcaster({ server, engine, adminToken: ADMIN_TOKEN });
		eventEmitter.register(broadcaster);

		port = (server.address() as { port: number }).port;
	});

	afterEach(async () => {
		broadcaster.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await dbClose();
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
