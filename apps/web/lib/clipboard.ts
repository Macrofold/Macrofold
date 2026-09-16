'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type CopyStatus = 'idle' | 'copying' | 'copied' | 'error';
export const clipboardUnavailable = 'Clipboard unavailable. Select and copy the text manually.';

/** Report browser acceptance; the initiating control owns user feedback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Show success for three seconds; recopying restarts feedback for the same content. */
export function useCopyFeedback(content?: string) {
  const [feedback, setFeedback] = useState<{
    content?: string;
    text?: string;
    status: CopyStatus;
    copied: boolean;
  }>({ status: 'idle', copied: false });
  const operation = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    setFeedback({ content, status: 'idle', copied: false });
    return () => {
      operation.current += 1;
      clearTimeout(resetTimer.current);
    };
  }, [content]);

  async function copy(text: string) {
    const current = ++operation.current;
    clearTimeout(resetTimer.current);
    setFeedback((previous) => ({
      content,
      text,
      status: 'copying',
      copied: previous.content === content && previous.text === text && previous.copied,
    }));
    const accepted = await copyText(text);
    if (current !== operation.current) return false;
    if (!accepted) {
      setFeedback({ content, text, status: 'error', copied: false });
      // A denied clipboard must not encourage discarding a one-time secret.
      toast.error(clipboardUnavailable);
      return false;
    }
    setFeedback({ content, text, status: 'copied', copied: true });
    resetTimer.current = setTimeout(() => {
      if (current === operation.current) setFeedback({ content, status: 'idle', copied: false });
    }, 3000);
    return true;
  }

  const status = feedback.content === content ? feedback.status : 'idle';
  return {
    copy,
    status,
    copied: feedback.content === content && feedback.copied,
    copying: status === 'copying',
  };
}
