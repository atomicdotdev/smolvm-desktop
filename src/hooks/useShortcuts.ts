import { useEffect } from "react";

/**
 * Map of shortcut keys (in the form used by `matches`) to handlers.
 *
 * Examples: "mod+n", "mod+1", "mod+,", "mod+r", "escape", "slash".
 */
export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

export function useShortcuts(map: ShortcutMap, deps: unknown[] = []) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't hijack typing.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const editing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (target?.isContentEditable ?? false);

      for (const [combo, fn] of Object.entries(map)) {
        if (!matches(e, combo)) continue;
        if (editing && !combo.startsWith("mod+")) continue;
        fn(e);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function matches(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.toLowerCase().split("+");
  const key = parts.pop()!;
  const needMod = parts.includes("mod");
  const needShift = parts.includes("shift");
  const needAlt = parts.includes("alt");

  const mod = e.metaKey || e.ctrlKey;
  if (needMod && !mod) return false;
  if (!needMod && mod) return false;
  if (needShift && !e.shiftKey) return false;
  if (needAlt && !e.altKey) return false;

  const pressed = e.key.toLowerCase();
  if (key === "escape") return pressed === "escape";
  if (key === "slash") return pressed === "/";
  if (key === ",") return pressed === ",";
  if (key.length === 1) return pressed === key;
  return pressed === key;
}
