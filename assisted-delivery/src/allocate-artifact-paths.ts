import { allocateArtifactVersion } from "./artifact-storage.js";

interface Arguments {
  baseName: string;
  extensions: string[];
  applicationName?: string;
  workLabel?: string;
  program?: string;
  explicitRoot?: string;
}

const USAGE =
  "Usage: --base <name> --extension <ext> [--extension <ext>] [--application <name>] [--label <work label>] [--program <alias>] [--root <path>]";

function parseArguments(argv: string[]): Arguments {
  const values = new Map<string, string>();
  const extensions: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`Option '${option ?? ""}' requires a value.`);
    }
    if (option === "--extension") {
      extensions.push(value);
    } else {
      values.set(option, value);
    }
    index += 1;
  }

  const baseName = values.get("--base");
  if (!baseName || extensions.length === 0) {
    throw new Error(USAGE);
  }
  // --request is the older name for the work label.
  const workLabel = values.get("--label") ?? values.get("--request");
  return {
    baseName,
    extensions,
    ...(workLabel ? { workLabel } : {}),
    ...(values.has("--application")
      ? { applicationName: values.get("--application")! }
      : {}),
    ...(values.has("--program") ? { program: values.get("--program")! } : {}),
    ...(values.has("--root") ? { explicitRoot: values.get("--root")! } : {}),
  };
}

const args = parseArguments(process.argv.slice(2));
const allocation = allocateArtifactVersion(args);
process.stdout.write(`${JSON.stringify(allocation, null, 2)}\n`);
