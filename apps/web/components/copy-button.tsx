'use client';

import { clsx } from 'clsx';
import { Copy } from 'lucide-react';
import type { ButtonHTMLAttributes } from 'react';
import { clipboardUnavailable, useCopyFeedback } from '../lib/clipboard';
import './copy-button.css';

export function CopyFeedback({
  status,
  label,
  iconOnly = false,
  copied = status === 'copied',
}: {
  status: ReturnType<typeof useCopyFeedback>['status'];
  label: string;
  iconOnly?: boolean;
  copied?: boolean;
}) {
  return (
    <>
      <span className="copy-feedback-icon" data-copied={copied} aria-hidden="true">
        <Copy size={14} className="copy-feedback-copy" />
        <svg
          className="copy-feedback-check"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m20 6-11 11-5-5" pathLength="1" />
        </svg>
      </span>
      <span className={iconOnly ? 'sr-only' : undefined}>{label}</span>
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {status === 'copied' ? 'Copied to clipboard' : status === 'error' ? clipboardUnavailable : ''}
      </span>
    </>
  );
}

export function CopyButton({
  text,
  label = 'Copy',
  variant = 'secondary',
  iconOnly = false,
  className,
  disabled,
  onClick,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  text: string;
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'plain';
  iconOnly?: boolean;
}) {
  const { copy, copied, copying, status } = useCopyFeedback(text);
  return (
    <button
      {...props}
      type="button"
      className={clsx('copy-button', variant !== 'plain' && ['button', variant], className)}
      disabled={disabled || copying}
      aria-label={props['aria-label'] || label}
      aria-description={status === 'error' ? clipboardUnavailable : props['aria-description']}
      aria-busy={copying}
      data-copy-state={status}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) void copy(text);
      }}
    >
      <CopyFeedback status={status} copied={copied} label={label} iconOnly={iconOnly} />
    </button>
  );
}
