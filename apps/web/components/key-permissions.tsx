'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  availableKeyPermissions,
  keyPermissionPresets,
  resolveKeyPermissions,
  type KeyPermissionSelection,
} from '../lib/key-permissions';
import { Select } from './select';
import { Field } from './ui';
import './key-permissions.css';

export function KeyPermissions({
  value,
  onChange,
  effectiveScopes,
}: {
  value: KeyPermissionSelection;
  onChange: (value: KeyPermissionSelection) => void;
  effectiveScopes: readonly string[];
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const scopes = resolveKeyPermissions(value, effectiveScopes);
  return (
    <div className="key-permissions">
      <Field
        label="Permissions"
        hint={keyPermissionPresets.find((preset) => preset.value === value.preset)?.description}
      >
        <Select
          value={value.preset}
          options={keyPermissionPresets}
          onValueChange={(next) => {
            const preset = keyPermissionPresets.find((item) => item.value === next)?.value;
            if (!preset) return;
            onChange(preset === 'custom' ? { preset, scopes } : { preset });
            if (preset === 'custom') setExpanded(true);
          }}
        />
      </Field>
      <button
        type="button"
        className="advanced-toggle"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((open) => !open)}
      >
        {expanded ? 'Hide permissions' : 'View permissions'}
        <span>({scopes.length} selected)</span>
        <ChevronDown size={14} />
      </button>
      <div className="key-permissions-disclosure" hidden={!expanded} id={id}>
        <div className="scope-grid" role="group" aria-label="Individual permissions">
          {availableKeyPermissions(effectiveScopes).map(({ scope, label }) => (
            <label key={scope}>
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(event) =>
                  onChange({
                    preset: 'custom',
                    scopes: event.target.checked
                      ? [...scopes, scope]
                      : scopes.filter((item) => item !== scope),
                  })
                }
              />
              <span>
                {label}
                <code>{scope}</code>
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
