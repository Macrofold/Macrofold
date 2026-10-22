import { expect, it } from 'vitest';
import { rustBooleanConstant } from '../../scripts/sdk/rust-boolean-constants';

const source = (literal: boolean) => `#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Hash, Serialize, Deserialize)]
pub enum Included {
    #[serde(rename = "${literal}")]
    ${literal ? 'True' : 'False'},
}`;

it.each([true, false])('retains the %s boolean literal with typed serde conversion', (literal) => {
  const adapted = rustBooleanConstant(source(literal), 'Included', literal);
  expect(adapted).toContain('#[serde(try_from = "bool", into = "bool")]');
  expect(adapted).toContain(`if value == ${literal}`);
  expect(adapted).toContain(`Err("Expected ${literal}")`);
  expect(adapted).toContain(`fn from(_: Included) -> bool {\n        ${literal}`);
});

it('requires the exact pinned-generator declaration before adapting it', () => {
  expect(() => rustBooleanConstant(source(true).replace('True,', 'True,\n    False,'), 'Included', true))
    .toThrow('Recheck Rust boolean constant generation');
  expect(() => rustBooleanConstant(source(false), 'Included', true))
    .toThrow('Recheck Rust boolean constant generation');
});
