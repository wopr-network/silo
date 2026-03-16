import { describe, expect, it } from "vitest";
import { parseInterrogationOutput } from "../../src/flows/interrogation-prompt.js";

describe("parseInterrogationOutput", () => {
  it("parses a complete interrogation output", () => {
    const output = `Some AI preamble text about inspecting the repo.

REPO_CONFIG:{"repo":"org/my-app","defaultBranch":"main","description":"A web API","languages":["typescript"],"monorepo":false,"ci":{"supported":true,"provider":"github-actions","gateCommand":"pnpm lint && pnpm build && pnpm test","hasMergeQueue":false,"requiredChecks":["build","test"]},"testing":{"supported":true,"framework":"vitest","runCommand":"pnpm test","hasCoverage":true,"coverageThreshold":98},"linting":{"supported":true,"tool":"biome","runCommand":"pnpm lint"},"formatting":{"supported":true,"tool":"biome","runCommand":"pnpm format"},"typeChecking":{"supported":true,"tool":"tsc","runCommand":"pnpm check"},"build":{"supported":true,"runCommand":"pnpm build","producesArtifacts":true,"dockerfile":false},"reviewBots":{"supported":false,"bots":[]},"docs":{"supported":false,"location":null,"hasApiDocs":false},"specManagement":{"tracker":"github-issues","specLocation":"issue-comments","hasTemplates":false},"security":{"hasEnvExample":false,"hasSecurityPolicy":false,"hasSecretScanning":false,"hasDependencyUpdates":false},"intelligence":{"hasClaudeMd":false,"hasAgentsMd":false,"conventions":["conventional-commits"],"ciGateCommand":"pnpm lint && pnpm build && pnpm test"}}
GAP:{"capability":"reviewBots","title":"Configure review bots","priority":"medium","description":"No review bots configured."}
GAP:{"capability":"docs","title":"Set up documentation","priority":"low","description":"No docs directory found."}
GAP:{"capability":"security","title":"Add SECURITY.md","priority":"low","description":"No security policy."}
CLAUDE_MD:# my-app

## CI Gate
pnpm lint && pnpm build && pnpm test

## Conventions
- Conventional commits (feat:, fix:, chore:)
- biome for lint and format

interrogation_complete`;

    const result = parseInterrogationOutput(output);

    expect(result.config.repo).toBe("org/my-app");
    expect(result.config.languages).toEqual(["typescript"]);
    expect(result.config.ci.supported).toBe(true);
    expect(result.config.ci.gateCommand).toBe("pnpm lint && pnpm build && pnpm test");
    expect(result.config.testing.framework).toBe("vitest");
    expect(result.config.reviewBots.supported).toBe(false);
    expect(result.config.intelligence.conventions).toEqual(["conventional-commits"]);

    expect(result.gaps).toHaveLength(3);
    expect(result.gaps[0].capability).toBe("reviewBots");
    expect(result.gaps[0].priority).toBe("medium");
    expect(result.gaps[1].capability).toBe("docs");
    expect(result.gaps[2].capability).toBe("security");

    expect(result.claudeMd).toContain("# my-app");
    expect(result.claudeMd).toContain("pnpm lint && pnpm build && pnpm test");
  });

  it("handles existing CLAUDE.md", () => {
    const output = `REPO_CONFIG:{"repo":"org/app","defaultBranch":"main","description":"test","languages":["go"],"monorepo":false,"ci":{"supported":false},"testing":{"supported":false},"linting":{"supported":false},"formatting":{"supported":false},"typeChecking":{"supported":false},"build":{"supported":false},"reviewBots":{"supported":false},"docs":{"supported":false},"specManagement":{"tracker":"github-issues"},"security":{},"intelligence":{"hasClaudeMd":true,"hasAgentsMd":false,"conventions":[],"ciGateCommand":null}}
CLAUDE_MD:EXISTS

interrogation_complete`;

    const result = parseInterrogationOutput(output);

    expect(result.config.repo).toBe("org/app");
    expect(result.config.intelligence.hasClaudeMd).toBe(true);
    expect(result.claudeMd).toBeNull();
    expect(result.gaps).toHaveLength(0);
  });

  it("handles no gaps", () => {
    const output = `REPO_CONFIG:{"repo":"org/perfect","defaultBranch":"main","description":"fully configured","languages":["typescript"],"monorepo":false,"ci":{"supported":true},"testing":{"supported":true},"linting":{"supported":true},"formatting":{"supported":true},"typeChecking":{"supported":true},"build":{"supported":true},"reviewBots":{"supported":true},"docs":{"supported":true},"specManagement":{"tracker":"github-issues"},"security":{"hasEnvExample":true,"hasSecurityPolicy":true,"hasSecretScanning":true,"hasDependencyUpdates":true},"intelligence":{"hasClaudeMd":true,"hasAgentsMd":false,"conventions":["conventional-commits"],"ciGateCommand":"pnpm lint && pnpm build && pnpm test"}}
CLAUDE_MD:EXISTS

interrogation_complete`;

    const result = parseInterrogationOutput(output);

    expect(result.config.repo).toBe("org/perfect");
    expect(result.gaps).toHaveLength(0);
    expect(result.claudeMd).toBeNull();
  });

  it("throws on missing REPO_CONFIG", () => {
    const output = `Just some text with no config.

interrogation_complete`;

    expect(() => parseInterrogationOutput(output)).toThrow("missing REPO_CONFIG");
  });

  it("handles multiline CLAUDE.md content", () => {
    const output = `REPO_CONFIG:{"repo":"org/app","defaultBranch":"main","description":"test","languages":["python"],"monorepo":false,"ci":{"supported":false},"testing":{"supported":false},"linting":{"supported":false},"formatting":{"supported":false},"typeChecking":{"supported":false},"build":{"supported":false},"reviewBots":{"supported":false},"docs":{"supported":false},"specManagement":{"tracker":"github-issues"},"security":{},"intelligence":{"hasClaudeMd":false,"hasAgentsMd":false,"conventions":[],"ciGateCommand":null}}
CLAUDE_MD:# My Python App

## Setup
pip install -r requirements.txt

## Testing
pytest

## Gotchas
- Always run black before committing
- The ML pipeline takes 20 minutes

interrogation_complete`;

    const result = parseInterrogationOutput(output);

    expect(result.claudeMd).toContain("# My Python App");
    expect(result.claudeMd).toContain("pip install -r requirements.txt");
    expect(result.claudeMd).toContain("ML pipeline takes 20 minutes");
  });
});
