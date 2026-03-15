import { and, eq } from "drizzle-orm";
import { githubInstallations } from "../repositories/drizzle/schema.js";

export interface GitHubInstallation {
  id: string;
  tenantId: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  accessToken: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGitHubInstallationRepository {
  upsert(installation: Omit<GitHubInstallation, "id" | "createdAt" | "updatedAt">): Promise<GitHubInstallation>;
  getByInstallationId(installationId: number): Promise<GitHubInstallation | null>;
  listByTenant(tenantId: string): Promise<GitHubInstallation[]>;
  remove(installationId: number): Promise<void>;
  updateToken(installationId: number, accessToken: string, expiresAt: Date): Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: cross-driver compat
type Db = any;

export class DrizzleGitHubInstallationRepository implements IGitHubInstallationRepository {
  constructor(
    private db: Db,
    private tenantId: string,
  ) {}

  async upsert(input: Omit<GitHubInstallation, "id" | "createdAt" | "updatedAt">): Promise<GitHubInstallation> {
    const id = crypto.randomUUID();
    const now = new Date();
    const row = {
      id,
      tenantId: input.tenantId,
      installationId: input.installationId,
      accountLogin: input.accountLogin,
      accountType: input.accountType,
      accessToken: input.accessToken,
      tokenExpiresAt: input.tokenExpiresAt,
      createdAt: now,
      updatedAt: now,
    };
    await this.db
      .insert(githubInstallations)
      .values(row)
      .onConflictDoUpdate({
        target: [githubInstallations.tenantId, githubInstallations.installationId],
        set: {
          accountLogin: input.accountLogin,
          accountType: input.accountType,
          accessToken: input.accessToken,
          tokenExpiresAt: input.tokenExpiresAt,
          updatedAt: now,
        },
      });
    const result = await this.getByInstallationId(input.installationId);
    if (!result) throw new Error(`Failed to upsert installation ${input.installationId}`);
    return result;
  }

  async getByInstallationId(installationId: number): Promise<GitHubInstallation | null> {
    const rows = await this.db
      .select()
      .from(githubInstallations)
      .where(
        and(eq(githubInstallations.installationId, installationId), eq(githubInstallations.tenantId, this.tenantId)),
      );
    if (rows.length === 0) return null;
    return this.toModel(rows[0]);
  }

  async listByTenant(tenantId: string): Promise<GitHubInstallation[]> {
    const rows = await this.db.select().from(githubInstallations).where(eq(githubInstallations.tenantId, tenantId));
    return rows.map((r: typeof githubInstallations.$inferSelect) => this.toModel(r));
  }

  async remove(installationId: number): Promise<void> {
    await this.db
      .delete(githubInstallations)
      .where(
        and(eq(githubInstallations.installationId, installationId), eq(githubInstallations.tenantId, this.tenantId)),
      );
  }

  async updateToken(installationId: number, accessToken: string, expiresAt: Date): Promise<void> {
    await this.db
      .update(githubInstallations)
      .set({ accessToken, tokenExpiresAt: expiresAt, updatedAt: new Date() })
      .where(
        and(eq(githubInstallations.installationId, installationId), eq(githubInstallations.tenantId, this.tenantId)),
      );
  }

  private toModel(row: typeof githubInstallations.$inferSelect): GitHubInstallation {
    return {
      id: row.id,
      tenantId: row.tenantId,
      installationId: row.installationId,
      accountLogin: row.accountLogin,
      accountType: row.accountType,
      accessToken: row.accessToken,
      tokenExpiresAt: row.tokenExpiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
