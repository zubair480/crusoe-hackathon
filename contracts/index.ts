export type * from './generated';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from './v1.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
export function assertContract(kind: string, data: unknown): void {
  if (!validate({ kind, data })) {
    throw new Error(`Invalid ${kind}: ${ajv.errorsText(validate.errors)}`);
  }
}
