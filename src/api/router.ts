export interface ParsedRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
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
    const patternStr = path.replace(/:([^/]+)/g, (_match, name) => {
      paramNames.push(name as string);
      return "([^/]+)";
    });
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
