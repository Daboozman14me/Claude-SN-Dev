// One rule for where every assisted-delivery document lives and what it is called:
//   <app folder>\<type folder>\<base>[-<work label>]-vNNN.<ext>
// The base names the document type (and never changes, so older files stay valid); the optional work
// label (epic number plus short name, e.g. "epic-4-room-gating") tells pieces of work apart; the version
// counts redos of the same work.

// Type folder for each document base. A base not listed here gets a folder of its own name.
export const ARTIFACT_TYPE_FOLDERS: Readonly<Record<string, string>> = {
  "application-research": "research",
  "research-lookup": "research",
  "solution-recommendation": "solution",
  "technical-design": "design",
  "story-draft": "stories",
  "test-plan": "tests",
  "code-implementation": "code",
  "completion-report": "code",
  "code-review": "reviews",
  backlog: "backlog",
  "user-guide": "user-guide",
  "requirements-extraction": "requirements",
  "level-of-effort": "loe",
  "update-set-delta": "update-sets",
};

export function artifactTypeFolder(baseName: string): string {
  return ARTIFACT_TYPE_FOLDERS[baseName] ?? baseName;
}

const LABEL = "[a-z0-9]+(?:-[a-z0-9]+)*";

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ArtifactName {
  // "<base>[-<label>]-vNNN", the stem shared by a document's HTML/JSON/MD files and its evidence folder.
  stem: string;
  label: string | undefined;
  versionLabel: string;
}

// Parses "<base>[-<label>]-vNNN.<extension>"; undefined when the file is not that document type.
export function parseArtifactFileName(fileName: string, baseName: string, extension: string): ArtifactName | undefined {
  const pattern = new RegExp(`^(${escapeForPattern(baseName)}(?:-(${LABEL}))?-(v[0-9]+))\\.${escapeForPattern(extension)}$`);
  const match = fileName.match(pattern);
  return match ? { stem: match[1]!, label: match[2], versionLabel: match[3]! } : undefined;
}

// The same rule as a pattern source, for checks that list several document types at once.
export function artifactStemPattern(baseName: string): string {
  return `${escapeForPattern(baseName)}(?:-${LABEL})?-v[0-9]+`;
}

export function artifactNamingHint(baseName: string, extension: string): string {
  return `${baseName}[-<work label>]-vNNN.${extension}`;
}

// RegExp-match shaped result ([whole name, stem]) so validators keep using match[1] as the stem.
export function matchArtifactFileName(fileName: string, baseName: string, extension = "json"): [string, string] | null {
  const parsed = parseArtifactFileName(fileName, baseName, extension);
  return parsed ? [fileName, parsed.stem] : null;
}
