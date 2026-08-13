import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';

const SCHEMA_FILES = {
  1: '../../schemas/observation-v1.schema.json',
  2: '../../schemas/observation-v2.schema.json'
};

const compiled = new Map();

/**
 * Compiles an observation schema by version. Kept separate from
 * `observations.mjs` on purpose: the hand-written validator and the schema must
 * be able to reject a bad observation independently of one another, so a bug in
 * one cannot mask the other.
 */
export async function observationValidator(schemaVersion) {
  if (compiled.has(schemaVersion)) return compiled.get(schemaVersion);

  const file = SCHEMA_FILES[schemaVersion];
  if (!file) throw new Error(`No observation schema for version ${schemaVersion}`);

  const schema = JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  compiled.set(schemaVersion, validate);
  return validate;
}

/** Returns Ajv error strings, or [] when the document satisfies its schema. */
export async function schemaErrors(observation, schemaVersion = observation?.schemaVersion) {
  const validate = await observationValidator(schemaVersion);
  if (validate(observation)) return [];
  return (validate.errors ?? []).map(
    (error) => `${error.instancePath || '/'}: ${error.message}`
  );
}
