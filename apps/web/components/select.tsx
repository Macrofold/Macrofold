'use client';

import * as Primitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState, type AriaAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import './select.css';

type Option = { value: string; label: ReactNode; disabled?: boolean };
type SelectProps = AriaAttributes & {
  options: readonly Option[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

/** One keyboard-accessible control for forms, filters and workspace navigation. */
export function Select({
  options,
  value,
  defaultValue = '',
  onValueChange,
  placeholder = 'Select…',
  id,
  name,
  disabled,
  required,
  className,
  ...aria
}: SelectProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selected = value ?? internalValue;
  // Radix reserves the empty string for clearing. Keep actual form values empty,
  // while allowing an explicit "All projects"/"Custom configuration" menu item.
  const emptyItem = useId();
  const emptyLabel = options.find((option) => option.value === '')?.label;
  return (
    <Primitive.Root
      value={selected}
      name={name}
      disabled={disabled || !options.length}
      required={required}
      onValueChange={(next) => {
        const resolved = next === emptyItem ? '' : next;
        setInternalValue(resolved);
        onValueChange?.(resolved);
      }}
    >
      <Primitive.Trigger id={id} className={clsx('select-trigger', className)} {...aria}>
        <Primitive.Value placeholder={emptyLabel ?? placeholder} />
        <Primitive.Icon className="select-chevron">
          <ChevronDown size={15} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12}>
          <Primitive.ScrollUpButton className="select-scroll">
            <ChevronUp size={14} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="select-viewport">
            {options.map((option) => (
              <Primitive.Item
                key={option.value}
                value={option.value || emptyItem}
                disabled={option.disabled}
                className="select-item"
              >
                <Primitive.ItemText>{option.label}</Primitive.ItemText>
                <Primitive.ItemIndicator className="select-check">
                  <Check size={15} />
                </Primitive.ItemIndicator>
              </Primitive.Item>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll">
            <ChevronDown size={14} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
