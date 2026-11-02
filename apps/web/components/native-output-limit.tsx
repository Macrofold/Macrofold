'use client';
import { Field } from './ui';

export function outputTokenLimit(value: string): { max_output_tokens?: number } {
  if (!value.trim()) return {};
  const tokens = Number(value);
  if (!Number.isSafeInteger(tokens) || tokens <= 0)
    throw new Error('Maximum output tokens must be a positive whole number.');
  return { max_output_tokens: tokens };
}

export function NativeOutputLimit({
  value,
  onChange,
  maximum,
  inherited,
}: {
  value: string;
  onChange: (value: string) => void;
  maximum?: number;
  inherited?: number;
}) {
  return (
    <Field
      label="Maximum output tokens per model call"
      hint={`Includes reasoning and tool-call output. The spending cap and deadline still apply.${maximum ? ` Model maximum: ${maximum.toLocaleString()}.` : ''}`}
    >
      <input
        type="number"
        min={1}
        step={1}
        max={maximum ?? Number.MAX_SAFE_INTEGER}
        placeholder={inherited ? `Inherit ${inherited.toLocaleString()}` : 'Automatic'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
