import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { operations, type Operation } from './schema';
export type Parameter = {
  name: string;
  wireName: string;
  type: string;
  required: boolean;
  nullable: boolean;
  body: boolean;
  path: boolean;
  query: boolean;
  header: boolean;
};
export type VendorOperation = {
  id: string;
  originalId: string;
  returnType: string;
  params: Parameter[];
  classname: string;
  module: string;
  contract: Operation;
};
export async function metadata(directory: string): Promise<VendorOperation[]> {
  const result: VendorOperation[] = [];
  for (const file of await readdir(directory, { recursive: true })) {
    if (!file.endsWith('.sdkmeta.json')) continue;
    const data: {
      classname: string;
      operations: Omit<VendorOperation, 'classname' | 'module' | 'contract'>[];
    } = JSON.parse(await readFile(path.join(directory, file), 'utf8'));
    for (const op of data.operations) {
      const contract = operations.find((o) => o.id === op.originalId);
      if (!contract) throw new Error(`Unknown generated operation: ${op.originalId}`);
      result.push({
        ...op,
        classname: data.classname,
        module: path.basename(file, '.sdkmeta.json'),
        contract,
      });
    }
  }
  if (
    result.length !== operations.length ||
    new Set(result.map((o) => o.originalId)).size !== operations.length
  )
    throw new Error('Every public operation must have exactly one generated resource method');
  return result.sort((a, b) => a.originalId.localeCompare(b.originalId));
}
export const dataParams = (op: VendorOperation) =>
  op.params.filter(
    (p) =>
      !p.path && !p.body && !['Idempotency-Key', 'X-Organization-Id', 'Last-Event-ID'].includes(p.wireName),
  );
