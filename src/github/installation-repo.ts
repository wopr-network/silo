import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { githubInstallations } from "../repositories/drizzle/schema.js";

// biome-ignore lint/suspicious/noExplicitAny: cross-driver Drizzle compat
type Db = any;

export interface GitHubInstallation {
  id: string;
  tenantId: string;
  installationId: number;
  accountLogin: string;
  createdAt: number;
}

/** Interface for GitHub App installation storage. All consumers must depend on this, never the concrete class. */
export interface IGitHubInstallationRepository {
  create(tenantId: string, installationId: number, accountLogin: string): Promise<GitHubInstallation>;
  getByTenantId(tenantId: string): Promise<GitHubInstallation[]>;
  getByInstallationId(installationId: number): Promise<GitHubInstallation | null>;
  delete(id: string): Promise<void>;
  deleteByInstallationId(installationId: number): Promise<void>;
}

export class DrizzleGitHubInstallationRepository implements IGitHubInstallationRepository {
  constructor(private db: Db) {}

  async create(tenantId: string, installationId: number, accountLogin: string): Promise<GitHubInstallation> {
    const row = {
      id: randomUUID(),
      tenantId,
      installationId,
      accountLogin,
      createdAt: Date.now(),
    };
    await this.db.insert(githubInstallations).values(row);
    return row;
  }

  async getByTenantId(tenantId: string): Promise<GitHubInstallation[]> {
    return this.db.select().from(githubInstallations).where(eq(githubInstallations.tenantId, tenantId));
  }

  async getByInstallationId(installationId: number): Promise<GitHubInstallation | null> {
    const rows = await this.db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.installationId, installationId))
      .limit(1);
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(githubInstallations).where(eq(githubInstallations.id, id));
  }

  async deleteByInstallationId(installationId: number): Promise<void> {
    await this.db.delete(githubInstallations).where(eq(githubInstallations.installationId, installationId));
  }
}
