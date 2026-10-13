import { allocateArtifactVersion } from "./artifact-storage.js";

interface Arguments {
  baseName: string;
  extensions: string[];
  applicationName?: string;
  requestSlug: string;
  explicitRoot?: string;
}

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
  const requestSlug = values.get("--request");
  if (!baseName || !requestSlug || extensions.length === 0) {
    throw new Error(
      "Usage: --base <name> --request <slug> --extension <ext> [--extension <ext>] [--application <name>] [--root <path>]",
    );
  }
  return {
    baseName,
    extensions,
    requestSlug,
    ...(values.has("--application")
      ? { applicationName: values.get("--application")! }
      : {}),
    ...(values.has("--root") ? { explicitRoot: values.get("--root")! } : {}),
  };
}

const args = parseArguments(process.argv.slice(2));
const allocation = allocateArtifactVersion(args);
process.stdout.write(`${JSON.stringify(allocation, null, 2)}\n`);
