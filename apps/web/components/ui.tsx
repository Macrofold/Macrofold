'use client';
import * as Dialog from '@radix-ui/react-dialog';
import { X, LoaderCircle, ArrowUpRight, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useId, isValidElement, cloneElement, type ReactElement } from 'react';
import { Select } from './select';
export { Select } from './select';
export function Button({
  children,
  variant = 'primary',
  busy = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button {...props} disabled={props.disabled || busy} className={clsx('button', variant, props.className)}>
      {busy && <LoaderCircle size={15} className="spin" />}
      {children}
    </button>
  );
}
export function More({
  query,
  label = 'Load more',
}: {
  query: {
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
    isFetchNextPageError: boolean;
  };
  label?: string;
}) {
  if (!query.hasNextPage) return null;
  return (
    <div className="pagination">
      <Button
        type="button"
        variant="secondary"
        busy={query.isFetchingNextPage}
        onClick={() => void query.fetchNextPage()}
      >
        {query.isFetchNextPageError ? 'Retry loading more' : label}
      </Button>
    </div>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={clsx('dialog', wide && 'wide', className)}>
          <div className="dialog-heading">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close dialog" className="icon-button">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  const control =
    isValidElement(children) &&
    (children.type === Select ||
      (typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)));
  return (
    <div className="field">
      <label id={`${id}-label`} htmlFor={control ? id : undefined}>
        {label}
      </label>
      {control
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            id,
            'aria-labelledby': `${id}-label`,
            ...(hint ? { 'aria-describedby': `${id}-hint` } : {}),
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span className={clsx('badge', status)}>
      <span className="status-dot" />
      {status.replaceAll('_', ' ')}
    </span>
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={20} />
      <span>Loading workspace…</span>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <TriangleAlert size={20} />
      <div>
        <strong>We couldn’t load this view</strong>
        <p>{error.message}</p>
      </div>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function SectionHeading({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description?: string;
  href?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {href ? (
        <Link className="text-link" href={href}>
          View all <ArrowUpRight size={14} />
        </Link>
      ) : (
        action
      )}
    </div>
  );
}
export function Logo() {
  return (
    <svg width="27" height="27" viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="5" fill="currentColor" />
      <ellipse
        cx="16"
        cy="16"
        rx="14"
        ry="8"
        transform="rotate(-40 16 16)"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M9 5c7-1 15 7 17 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7" cy="7" r="2.4" fill="currentColor" />
    </svg>
  );
}
