'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowRight,
  ArrowUp,
  BookOpen,
  Copy,
  Github,
  LifeBuoy,
  MessageCircle,
  Sparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { assistantGuidance, type AssistantGuidance } from '../lib/dashboard-assistant';
import { CopyButton } from './copy-button';
import { docsRepository } from '../lib/docs/settings';
import { Button } from './ui';
import './dashboard-assistant.css';

type Exchange = { question: string; guidance: AssistantGuidance };

export function DashboardAssistant({ organizationId }: { organizationId?: string }) {
  // Remount the local conversation before any new organization can display it.
  return <AssistantPanel key={organizationId ?? 'pending-organization'} />;
}

function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [prompt, setPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState('');
  const conversationEnd = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (exchanges.length) conversationEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [exchanges.length]);

  function ask(value: string) {
    const text = value.trim();
    if (!text) return;
    setExchanges((previous) => [...previous, { question: text, guidance: assistantGuidance(text) }]);
    setQuestion('');
    input.current?.focus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(question);
  }

  async function showPrompt() {
    setPromptLoading(true);
    setPromptError('');
    try {
      const { setupPrompt } = await import('../lib/docs/content');
      const text = setupPrompt(window.location.origin).replace(
        'Deployment: [Macrofold Cloud, or my self-hosted/local origin.]',
        `Deployment: ${window.location.origin}`,
      );
      if (mounted.current) setPrompt(text);
    } catch {
      if (mounted.current)
        setPromptError('The setup prompt could not load. Try again or open the Build with AI guide.');
    } finally {
      if (mounted.current) setPromptLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="assistant-launcher">
          <MessageCircle size={17} aria-hidden="true" />
          <span>Ask Macrofold</span>
          <span className="assistant-launcher-dot" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="assistant-overlay" />
        <Dialog.Content
          className="assistant-panel"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            input.current?.focus();
          }}
        >
          <header className="assistant-heading">
            <span className="assistant-symbol">
              <Sparkles size={19} aria-hidden="true" />
            </span>
            <div>
              <Dialog.Title>
                Macrofold assistant <span className="assistant-preview">Preview</span>
              </Dialog.Title>
              <Dialog.Description>Sample guidance. No account changes or agent execution.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="Close assistant">
                <X size={18} />
              </button>
            </Dialog.Close>
          </header>
          <Tabs.Root defaultValue="assistant" className="assistant-tabs">
            <Tabs.List aria-label="Assistant views" className="assistant-tab-list">
              <Tabs.Trigger value="assistant">
                <Sparkles size={14} aria-hidden="true" />
                Assistant
              </Tabs.Trigger>
              <Tabs.Trigger value="support">
                <LifeBuoy size={14} aria-hidden="true" />
                Help & resources
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="assistant" className="assistant-tab-content">
              <div className="assistant-conversation">
                <div className="assistant-intro">
                  <span className="assistant-intro-icon">
                    <Sparkles size={24} aria-hidden="true" />
                  </span>
                  <h3>A little help, a clear next step.</h3>
                  <p>Explore setup, find the right settings, or get a prompt for your coding agent.</p>
                </div>
                {!exchanges.length && (
                  <div className="assistant-suggestions" aria-label="Suggested questions">
                    {[
                      'Help me get started',
                      'Connect an account',
                      'Set up the API',
                      'Review costs and budgets',
                    ].map((suggestion) => (
                      <button key={suggestion} type="button" onClick={() => ask(suggestion)}>
                        {suggestion}
                        <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}
                <div
                  role="log"
                  aria-label="Assistant conversation"
                  aria-live="polite"
                  aria-relevant="additions"
                >
                  {exchanges.map((exchange, index) => (
                    <div className="assistant-exchange" key={index}>
                      <p className="assistant-question">
                        <span className="sr-only">You: </span>
                        {exchange.question}
                      </p>
                      <div className="assistant-answer">
                        <span className="assistant-answer-label">
                          <Sparkles size={13} aria-hidden="true" />
                          Sample guidance
                        </span>
                        <h4>{exchange.guidance.title}</h4>
                        <p>{exchange.guidance.answer}</p>
                        <div className="assistant-answer-actions">
                          <Link href={exchange.guidance.href} onClick={() => setOpen(false)}>
                            {exchange.guidance.action}
                            <ArrowRight size={13} aria-hidden="true" />
                          </Link>
                          <Link href={exchange.guidance.guide} onClick={() => setOpen(false)}>
                            Read guide
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <section className="assistant-prompt-card" aria-label="Build with your coding agent">
                  <div>
                    <Copy size={17} aria-hidden="true" />
                    <strong>Take the next step with your AI</strong>
                  </div>
                  <p>
                    A ready-to-adapt brief with this deployment’s documentation. Add your goal, then paste it
                    into your coding agent.
                  </p>
                  {!prompt ? (
                    <Button type="button" variant="secondary" busy={promptLoading} onClick={showPrompt}>
                      {promptError ? 'Retry setup prompt' : 'Get setup prompt'}
                      <ArrowRight size={14} aria-hidden="true" />
                    </Button>
                  ) : (
                    <>
                      <CopyButton text={prompt} label="Copy setup prompt" />
                      <details className="assistant-prompt-preview">
                        <summary>Read or copy manually</summary>
                        <textarea aria-label="Coding-agent setup prompt" readOnly value={prompt} rows={8} />
                      </details>
                    </>
                  )}
                  {promptError && (
                    <p role="alert">
                      {promptError}{' '}
                      <Link href="/docs/agents" onClick={() => setOpen(false)}>
                        Open guide
                      </Link>
                    </p>
                  )}
                </section>
                <div ref={conversationEnd} />
              </div>
              <form className="assistant-composer" onSubmit={submit}>
                <div className="assistant-composer-input input-surface">
                  <textarea
                    ref={input}
                    value={question}
                    maxLength={2000}
                    rows={2}
                    aria-label="Ask Macrofold a question"
                    placeholder="What would you like help with?"
                    onChange={(event) => setQuestion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        ask(question);
                      }
                    }}
                  />
                  <Button type="submit" aria-label="Send question" disabled={!question.trim()}>
                    <ArrowUp size={17} aria-hidden="true" />
                  </Button>
                </div>
                <p>Replies are examples. Keep secrets out of chat.</p>
              </form>
            </Tabs.Content>
            <Tabs.Content value="support" className="assistant-help">
              <h3>Find your next answer.</h3>
              <p>Guides for building, operating, and troubleshooting your account.</p>
              <Link href="/docs" onClick={() => setOpen(false)}>
                <BookOpen size={19} aria-hidden="true" />
                <span>
                  <strong>Documentation</strong>
                  <small>Quickstarts and detailed guides</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link href="/docs/troubleshooting" onClick={() => setOpen(false)}>
                <LifeBuoy size={19} aria-hidden="true" />
                <span>
                  <strong>Troubleshooting</strong>
                  <small>Access, runs, files, and recovery</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <a href={`${docsRepository}/issues`} target="_blank" rel="noreferrer">
                <Github size={19} aria-hidden="true" />
                <span>
                  <strong>Report an issue</strong>
                  <small>Open the public GitHub issue tracker</small>
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </a>
              <div className="assistant-support-note">
                <strong>Share only what is needed.</strong>
                <p>
                  Use an error code and a small, redacted reproduction. Keep keys, prompts, and private files
                  out of public reports. This preview does not send support requests.
                </p>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
