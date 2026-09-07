'use client';
import { toast } from 'sonner';

/** A denied clipboard must not encourage users to discard a one-time secret. */
export async function copyText(text: string, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error('Clipboard unavailable. Select and copy the text manually.');
  }
}
