import { expect, it } from 'vitest';
import { javaUnionConstraints } from '../../scripts/sdk/java-deployment-unions';

const source = `// deserialize Model
            try {
                boolean attemptParsing = true;`;
const variant = { model: 'Model', required: ['kind'], properties: ['kind', 'engine'], closed: true };

it('retains required and closed property constraints before Java oneOf decoding', () => {
  const adapted = javaUnionConstraints(source, [variant]);
  expect(adapted).toContain('tree.isObject() && tree.hasNonNull("kind")');
  expect(adapted).toContain('java.util.Set.of("kind", "engine")::contains');
});
it('preserves an authored open object', () => {
  expect(javaUnionConstraints(source, [{ ...variant, closed: false }])).not.toContain('Set.of');
});
it('fails if a pinned vendor union anchor changes', () => {
  expect(() => javaUnionConstraints(source.replace('true;', 'false;'), [variant])).toThrow(
    'Recheck Java union generation',
  );
});
