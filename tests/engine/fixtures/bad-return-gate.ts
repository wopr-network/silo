// Fixture: returns wrong shape (no `passed` boolean) to test return-shape validation
export function check(): unknown {
  return { status: "ok" }; // wrong shape — missing `passed`
}
