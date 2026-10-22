import { expect, it } from 'vitest';
import { pythonBooleanConstants } from '../../scripts/sdk/python-boolean-constants';

const source = (type: string, literal: string) => `    included: ${type}

    @field_validator('included')
    def included_validate_enum(cls, value):
        """Validates the enum"""
        if value not in set(['${literal}']):
            raise ValueError('Incorrect constant')
        return value
`;
it.each(['true', 'false'])(
  'preserves the %s boolean constant as a strict boolean identity check',
  (literal) => {
    const adapted = pythonBooleanConstants(source('StrictBool', literal));
    expect(adapted).toContain(`if value is not ${literal === 'true' ? 'True' : 'False'}:`);
    expect(adapted).toContain("raise ValueError('Incorrect constant')");
  },
);
it('preserves string-valued true and false enum checks', () => {
  expect(pythonBooleanConstants(source('StrictStr', 'false'))).toBe(source('StrictStr', 'false'));
});
