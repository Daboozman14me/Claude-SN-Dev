import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ingestDocuments } from "./document-ingestion.js";
import { isDirectExecution } from "./direct-execution.js";

export interface IngestDocumentArguments {
  sourcePath: string;
  outputPath?: string;
}

export function parseIngestDocumentArguments(
  argv: string[],
): IngestDocumentArguments {
  const sourcePath = argv[0];
  if (!sourcePath) {
    throw new Error(
      "Usage: npm run ingest:documents -- <file-or-folder> [--output <allocated-json-path>]",
    );
  }
  if (argv.length === 1) {
    return { sourcePath };
  }
  if (argv.length !== 3 || argv[1] !== "--output" || !argv[2]) {
    throw new Error(
      "Usage: npm run ingest:documents -- <file-or-folder> [--output <allocated-json-path>]",
    );
  }
  return { sourcePath, outputPath: argv[2] };
}

export async function runIngestDocumentsCli(argv: string[]): Promise<string> {
  const input = parseIngestDocumentArguments(argv);
  const result = await ingestDocuments(input.sourcePath);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (input.outputPath) {
    const outputPath = resolve(input.outputPath);
    if (existsSync(outputPath)) {
      throw new Error(
        `Refusing to overwrite existing ingestion artifact '${outputPath}'. Allocate a new versioned path.`,
      );
    }
    writeFileSync(outputPath, json, { flag: "wx" });
    return outputPath;
  }
  return json;
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  try {
    const output = await runIngestDocumentsCli(process.argv.slice(2));
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Document ingestion failed: ${message}\n`);
    process.exitCode = 1;
  }
}
