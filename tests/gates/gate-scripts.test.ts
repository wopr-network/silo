import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const GATES_DIR = resolve(import.meta.dirname, "../../gates");

const SCRIPTS = [
	"check-unblocked.sh",
	"check-pr-capacity.sh",
	"check-spec-posted.sh",
	"check-design-posted.sh",
	"check-review-ready.sh",
	"check-merge.sh",
];

describe("gate scripts", () => {
	for (const script of SCRIPTS) {
		const scriptPath = resolve(GATES_DIR, script);

		it(`${script} exists and is executable`, async () => {
			await access(scriptPath, constants.X_OK);
		});

		it(`${script} fails with usage message when no args`, async () => {
			try {
				await execFileAsync(scriptPath, [], {
					timeout: 5000,
					env: { ...process.env, LINEAR_API_KEY: "" },
				});
				expect.unreachable("should have exited non-zero");
			} catch (err) {
				const e = err as { code: number; stderr: string };
				expect(e.code).not.toBe(0);
				expect(e.stderr).toMatch(/Usage:/);
			}
		});
	}

	it("check-unblocked.sh fails when LINEAR_API_KEY missing", async () => {
		try {
			await execFileAsync(resolve(GATES_DIR, "check-unblocked.sh"), ["fake-id"], {
				timeout: 5000,
				env: { PATH: process.env.PATH },
			});
			expect.unreachable("should have exited non-zero");
		} catch (err) {
			const e = err as { code: number; stderr: string };
			expect(e.code).not.toBe(0);
			expect(e.stderr).toMatch(/LINEAR_API_KEY/);
		}
	});

	it("check-pr-capacity.sh fails when gh not authenticated", async () => {
		try {
			await execFileAsync(
				resolve(GATES_DIR, "check-pr-capacity.sh"),
				["nonexistent/repo"],
				{ timeout: 10000, env: { PATH: process.env.PATH, HOME: "/tmp" } },
			);
			expect.unreachable("should have exited non-zero");
		} catch (err) {
			const e = err as { code: number };
			expect(e.code).not.toBe(0);
		}
	});
});
