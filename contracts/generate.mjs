import { compile } from 'json-schema-to-typescript';
import { readFile, writeFile } from 'node:fs/promises';
const schema = JSON.parse(await readFile(new URL('./v1.schema.json', import.meta.url), 'utf8'));
await writeFile(new URL('./generated.ts', import.meta.url), await compile(schema, 'ExchangeEnvelope', { additionalProperties: false, unreachableDefinitions: true }));
