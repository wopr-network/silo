import { createSign } from "node:crypto";

/**
 * Generate a GitHub App JWT for authentication.
 * The JWT is valid for up to 10 minutes.
 */
export function generateAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 600,
      iss: appId,
    }),
  ).toString("base64url");

  const signable = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signable);
  const signature = sign.sign(privateKey, "base64url");

  return `${signable}.${signature}`;
}

/**
 * Exchange an installation ID for an installation access token via the GitHub API.
 */
export async function getInstallationAccessToken(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const jwt = generateAppJwt(appId, privateKey);

  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { token: string; expires_at: string };
  return {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };
}
