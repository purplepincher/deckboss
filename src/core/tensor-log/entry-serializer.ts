import yaml from "js-yaml";
import type { LogEntry } from "../types/log-entry";

/**
 * LogEntry -> Markdown string. Frontmatter carries the complete machine
 * record (including `corrections`); the body duplicates the original
 * transcript text for human readability when opened directly in a text
 * editor, plus a human-readable rendering of any corrections appended
 * below. The body is cosmetic — entry-parser.ts reads frontmatter only.
 */
export function serializeEntry(entry: LogEntry): string {
  const yamlText = yaml
    .dump(entry, { noRefs: true, lineWidth: -1, sortKeys: false })
    .trimEnd();

  const bodyText = entry.transcript?.text ?? "";
  const correctionsSection = renderCorrectionsSection(entry);

  return `---\n${yamlText}\n---\n\n${bodyText}\n${correctionsSection}`;
}

function renderCorrectionsSection(entry: LogEntry): string {
  if (entry.corrections.length === 0) return "";

  const lines = entry.corrections.map((c) => {
    const changed =
      c.type === "amend" && c.fields ? ` — changed: ${Object.keys(c.fields).join(", ")}` : "";
    const reason = c.reason ? ` — ${c.reason}` : "";
    return `- ${c.created_at} (${c.type})${changed}${reason}`;
  });

  return `\n---\n\n## Corrections\n\n${lines.join("\n")}\n`;
}
