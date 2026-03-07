import { describe, expect, it } from "vitest";
import { redact, redactString } from "../../src/utils/redact.js";

describe("redact", () => {
	it("masks values with sensitive keys", () => {
		const input = {
			name: "test",
			apiKey: "sk-ant-abc123",
			token: "xoxb-secret",
			password: "hunter2",
			bearerToken: "Bearer xyz",
			authHeader: "Basic abc",
			clientSecret: "s3cret",
			credential: "cred-value",
		};
		const result = redact(input) as Record<string, unknown>;
		expect(result.name).toBe("test");
		expect(result.apiKey).toBe("[REDACTED]");
		expect(result.token).toBe("[REDACTED]");
		expect(result.password).toBe("[REDACTED]");
		expect(result.bearerToken).toBe("[REDACTED]");
		expect(result.authHeader).toBe("[REDACTED]");
		expect(result.clientSecret).toBe("[REDACTED]");
		expect(result.credential).toBe("[REDACTED]");
	});

	it("truncates description fields to 100 chars", () => {
		const longDesc = "a".repeat(200);
		const input = { description: longDesc, title: "keep" };
		const result = redact(input) as Record<string, unknown>;
		expect(result.description).toBe("a".repeat(100) + "...");
		expect(result.title).toBe("keep");
	});

	it("does not truncate short descriptions", () => {
		const input = { description: "short" };
		const result = redact(input) as Record<string, unknown>;
		expect(result.description).toBe("short");
	});

	it("handles nested objects", () => {
		const input = { outer: { apiKey: "secret", name: "ok" } };
		const result = redact(input) as Record<string, unknown>;
		const outer = result.outer as Record<string, unknown>;
		expect(outer.apiKey).toBe("[REDACTED]");
		expect(outer.name).toBe("ok");
	});

	it("handles arrays", () => {
		const input = [{ token: "abc" }, { name: "ok" }];
		const result = redact(input) as Record<string, unknown>[];
		expect(result[0].token).toBe("[REDACTED]");
		expect(result[1].name).toBe("ok");
	});

	it("passes through primitives", () => {
		expect(redact(null)).toBe(null);
		expect(redact(undefined)).toBe(undefined);
		expect(redact(42)).toBe(42);
		expect(redact("hello")).toBe("hello");
		expect(redact(true)).toBe(true);
	});

	it("passes through Date objects without walking", () => {
		const d = new Date("2025-01-01");
		const input = { emittedAt: d, token: "secret" };
		const result = redact(input) as Record<string, unknown>;
		expect(result.emittedAt).toEqual(d);
		expect(result.token).toBe("[REDACTED]");
	});

	it("handles circular references without infinite loop", () => {
		const obj: Record<string, unknown> = { name: "test" };
		obj.self = obj;
		const result = redact(obj) as Record<string, unknown>;
		expect(result.name).toBe("test");
		expect(result.self).toBe("[Circular]");
	});

	it("does not mutate the original object", () => {
		const input = { apiKey: "secret", name: "test" };
		redact(input);
		expect(input.apiKey).toBe("secret");
	});
});

describe("redactString", () => {
	it("truncates to maxLength (default 500)", () => {
		const long = "x".repeat(600);
		const result = redactString(long);
		expect(result.length).toBeLessThanOrEqual(503); // 500 + "..."
		expect(result.endsWith("...")).toBe(true);
	});

	it("strips embedded bearer tokens", () => {
		const input = "Response: Bearer sk-ant-abc123xyz end";
		const result = redactString(input);
		expect(result).not.toContain("sk-ant-abc123xyz");
		expect(result).toContain("[REDACTED]");
	});

	it("strips embedded API keys (sk-ant-*, sk-*)", () => {
		const input = "Use key sk-ant-api03-abcdef123 for auth";
		const result = redactString(input);
		expect(result).not.toContain("sk-ant-api03-abcdef123");
	});

	it("strips embedded passwords in key=value format", () => {
		const input = "config: password=hunter2 done";
		const result = redactString(input);
		expect(result).not.toContain("hunter2");
	});

	it("does not truncate short strings", () => {
		expect(redactString("hello")).toBe("hello");
	});

	it("accepts custom maxLength", () => {
		const result = redactString("a".repeat(200), 50);
		expect(result.length).toBeLessThanOrEqual(53);
	});
});
