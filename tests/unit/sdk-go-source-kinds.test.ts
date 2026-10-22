import { expect, it } from 'vitest';
import { goSourceKind } from '../../scripts/sdk/go-source-kinds';

it('retains the literal source kind before decoding its generated model', () => {
  const adapted = goSourceKind('\tvarSource := _Source{}', 'Source', 'external');
  expect(adapted).toContain('if kind, ok := allProperties["kind"].(string); !ok || kind != "external"');
  expect(adapted).toContain('return fmt.Errorf("expected source kind external")');
  expect(adapted).toContain('\tvarSource := _Source{}');
});

it('fails when the pinned generator declaration changes', () => {
  expect(() => goSourceKind('varSource := Source{}', 'Source', 'hugging_face')).toThrow(
    'Recheck Go source kind generation',
  );
});
