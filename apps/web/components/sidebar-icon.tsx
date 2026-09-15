import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import './sidebar-icon.css';

/** Decorative SVG: its containing link or button owns the label and interaction. */
export function SidebarIcon({
  icon: Icon,
  size = 18,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <Icon
      size={size}
      className={clsx('sidebar-animated-icon', className)}
      aria-hidden="true"
      focusable="false"
    />
  );
}
