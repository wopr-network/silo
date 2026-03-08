/**
 * Split a command string into words, respecting single quotes, double quotes,
 * and backslash escapes. Follows POSIX shell quoting rules (simplified).
 *
 * - Single quotes: preserve everything literally (no escape sequences)
 * - Double quotes: preserve content, but backslash escapes \\ and \"
 * - Backslash outside quotes: escapes the next character
 */
export function splitShellWords(cmd: string): string[] {
  const words: string[] = [];
  let current = "";
  let i = 0;
  let inWord = false;

  while (i < cmd.length) {
    const ch = cmd[i];

    if (ch === "'") {
      inWord = true;
      i++;
      const start = i;
      while (i < cmd.length && cmd[i] !== "'") i++;
      if (i >= cmd.length) throw new Error("Unterminated single quote");
      current += cmd.slice(start, i);
      i++; // skip closing quote
    } else if (ch === '"') {
      inWord = true;
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < cmd.length) {
          const next = cmd[i + 1];
          if (next === '"' || next === "\\") {
            current += next;
            i += 2;
          } else {
            current += cmd[i];
            i++;
          }
        } else {
          if (cmd[i] === '"') break;
          current += cmd[i];
          i++;
        }
      }
      if (i >= cmd.length) throw new Error("Unterminated double quote");
      i++; // skip closing quote
    } else if (ch === "\\" && i + 1 < cmd.length) {
      inWord = true;
      current += cmd[i + 1];
      i += 2;
    } else if (ch === " " || ch === "\t") {
      if (inWord) {
        words.push(current);
        current = "";
        inWord = false;
      }
      i++;
    } else {
      inWord = true;
      current += ch;
      i++;
    }
  }

  if (inWord) {
    words.push(current);
  }

  return words;
}
