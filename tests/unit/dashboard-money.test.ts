import { expect, it } from 'vitest';
import { money } from '../../apps/web/lib/client';

it.each([
  [undefined, '$0.00'],
  ['0', '$0.00'],
  ['1', '$0.000001'],
  ['150', '$0.00015'],
  ['-150', '-$0.00015'],
  ['9999', '$0.009999'],
  ['10000', '$0.01'],
  ['1234567', '$1.23'],
] as const)('displays %s microdollars without rounding a sub-cent charge to zero', (value, expected) => {
  expect(money(value)).toBe(expected);
});
