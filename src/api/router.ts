export interface ParsedRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
  authorization?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

type Handler = (req: ParsedRequest) => Promise<ApiResponse>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

interface MatchResult {
  params: Record<string, string>;
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): void {
    const paramNames: string[] = [];
    // Split on param segments, escape literal segments, then reassemble
    const patternStr = path
      .split(/(:([^/]+))/g)
      .map((segment, i) => {
        // Every 3rd token (i % 3 === 1) is the full ":name" match — replace with capture group
        if (i % 3 === 1) {
          paramNames.push(segment.slice(1));
          return "([^/]+)";
        }
        // Every 3rd+1 token (i % 3 === 2) is the captured name — skip (already handled above)
        if (i % 3 === 2) return "";
        // Literal segment — escape regex metacharacters
        return segment.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    this.routes.push({
      method,
      pattern: new RegExp(`^${patternStr}$`),
      paramNames,
      handler,
    });
  }

  match(method: string, pathname: string): MatchResult | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = pathname.match(route.pattern);
      if (m) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, i) => {
          params[name] = m[i + 1] as string;
        });
        return { params, handler: route.handler };
      }
    }
    return null;
  }
}
