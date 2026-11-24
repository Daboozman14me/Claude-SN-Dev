import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDirectExecution } from "./direct-execution.js";

// Research keeps raw query output as evidence (configuration and code in full), but personal details in
// it are masked first: emails, phone numbers, and the values of personal-name/contact fields.
export const MASK = "[masked]";
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w.-])(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w-])/g;
const PERSONAL_KEYS = /"(email|phone|mobile_phone|home_phone|business_phone|first_name|last_name|middle_name|employee_number)"\s*:\s*("(?:[^"\\]|\\.)*"|\{[^{}]*\})/gi;

export function maskText(text: string): { text: string; masked: number } {
  let masked = 0;
  const count = <T>(value: T): T => {
    masked += 1;
    return value;
  };
  const result = text
    .replace(PERSONAL_KEYS, (match, key: string, value: string) => (value === `"${MASK}"` || value === '""' || /^\{\s*("display_value"\s*:\s*""\s*,?\s*|"value"\s*:\s*""\s*,?\s*)*\}$/.test(value) ? match : count(`"${key}":"${MASK}"`)))
    .replace(EMAIL, () => count(MASK))
    .replace(PHONE, () => count(MASK));
  return { text: result, masked };
}

export function findPersonalData(text: string): string[] {
  const found = [...text.matchAll(EMAIL)].map((match) => `email ${match[0].replace(/^(.).*(@.*)$/, "$1…$2")}`);
  found.push(...[...text.matchAll(PHONE)].map(() => "phone number"));
  for (const match of text.matchAll(PERSONAL_KEYS)) {
    const value = match[2]!;
    if (value !== `"${MASK}"` && value !== '""' && !/^\{[^{}]*""[^{}]*\}$/.test(value)) found.push(`${match[1]} value`);
  }
  return found;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

export function maskEvidenceDirectory(dir: string): { files: number; masked: number } {
  let masked = 0;
  let changed = 0;
  for (const path of files(resolve(dir))) {
    const result = maskText(readFileSync(path, "utf8"));
    if (result.masked > 0) {
      writeFileSync(path, result.text);
      masked += result.masked;
      changed += 1;
    }
  }
  return { files: changed, masked };
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  const dir = process.argv[2];
  try {
    if (!dir) throw new Error("Usage: npm run evidence:mask -- <evidence directory>");
    const result = maskEvidenceDirectory(dir);
    process.stdout.write(`Masked ${result.masked} personal value(s) in ${result.files} file(s).\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
