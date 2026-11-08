import { z } from "zod";
import {
  codeImplementationPackageSchema,
  codeReviewPackageSchema,
  completionReportPackageSchema,
} from "./assisted-contracts.js";
import { isDirectExecution } from "./direct-execution.js";

// Lets an agent read the one package shape it writes instead of the whole contracts file.
// Cross-field rules live in superRefine and are enforced by the validators, not shown here.
const SCHEMAS: Record<string, z.ZodType> = {
  code_implementation: codeImplementationPackageSchema,
  code_review: codeReviewPackageSchema,
  completion_report: completionReportPackageSchema,
};

export function contractJsonSchema(packageType: string): unknown {
  const schema = SCHEMAS[packageType];
  if (!schema) throw new Error(`Unknown package type '${packageType}'. Known: ${Object.keys(SCHEMAS).join(", ")}.`);
  return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const packageType = process.argv[2];
  try {
    if (!packageType) throw new Error(`Usage: npm run contract:schema -- <${Object.keys(SCHEMAS).join("|")}>`);
    process.stdout.write(`${JSON.stringify(contractJsonSchema(packageType), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
