import { describe, expect, it } from 'vitest';
import {
  agentTemplates,
  featuredTemplates,
  findAgentTemplate,
  plannedTemplates,
  searchTemplates,
  templateCodingPrompt,
  templatePreset,
} from '../../apps/web/components/templates/catalog';
import { findPage } from '../../apps/web/lib/docs/content';

describe('agent starter selection', () => {
  it('features five actionable starters, including a personal use case', () => {
    expect(featuredTemplates.map((template) => template.slug)).toEqual([
      'research-brief',
      'code-review',
      'data-analyst',
      'support-triage',
      'personal-assistant',
    ]);
  });

  it('keeps the personal starter limited to selected files and explicitly authorized actions', () => {
    expect(templatePreset('personal-assistant')).toEqual({
      name: 'Personal assistant',
      instructions: expect.stringContaining('Save personal-plan.md'),
    });
    const instructions = templatePreset('personal-assistant')?.instructions;
    expect(instructions).toContain(
      'Use only the files needed for this task and explicitly authorized connections',
    );
    expect(instructions).toContain('do not copy sensitive records into summaries unnecessarily');
    expect(instructions).toContain('without my explicit authorization for those actions');
    expect(instructions).toContain('Do not create a recurring schedule automatically');
  });

  it.each([null, undefined, '', 'unknown', '../code-review', 'CODE-REVIEW', 'release-notes'])(
    'does not prefill a preset from an unknown or planned selector: %s',
    (slug) => {
      expect(findAgentTemplate(slug)).toBeUndefined();
      expect(templatePreset(slug)).toBeUndefined();
    },
  );

  it('prefills instructions without choosing funding, model, account, workspace, or grants', () => {
    expect(templatePreset('code-review')).toEqual({
      name: 'Code review',
      instructions: expect.stringContaining('Do not modify implementation files'),
    });
    expect(templatePreset('support-triage')?.instructions).toContain(
      'Do not send replies, change tickets, or contact anyone',
    );
    expect(templatePreset('weekly-workspace-digest')?.instructions).toContain(
      'configured separately with an explicit prompt, timezone, and budget',
    );
  });

  it('searches task text and categories regardless of case, whitespace, or term order', () => {
    expect(searchTemplates(agentTemplates, '  REVIEW   engineering ').map((item) => item.slug)).toEqual([
      'code-review',
    ]);
    expect(searchTemplates(agentTemplates, 'OPERATIONS').map((item) => item.slug)).toEqual([
      'support-triage',
      'weekly-workspace-digest',
    ]);
    expect(searchTemplates(agentTemplates, 'dataset').map((item) => item.slug)).toEqual(['data-analyst']);
    expect(searchTemplates(agentTemplates, '   ')).toHaveLength(6);
    expect(searchTemplates(agentTemplates, 'personal errands').map((item) => item.slug)).toEqual([
      'personal-assistant',
    ]);
    expect(searchTemplates(agentTemplates, 'weekly').map((item) => item.slug)).toEqual([
      'weekly-workspace-digest',
    ]);
    expect(searchTemplates(agentTemplates, 'nonexistent')).toEqual([]);
    expect(searchTemplates(plannedTemplates, 'release').map((item) => item.slug)).toEqual(['release-notes']);
  });

  it.each(['https://app.macrofold.ai', 'https://self-host.example.test', 'http://localhost:3210'])(
    'copies a deployment-specific brief with published documentation at %s',
    (origin) => {
      const template = findAgentTemplate('research-brief');
      if (!template) throw new Error('Research starter is missing');
      const prompt = templateCodingPrompt(template, `${origin}/templates?ignored=private`);
      expect(prompt).toContain(`Deployment: ${origin}`);
      expect(prompt).toContain('Agent instructions:\nBuild a concise research brief');
      expect(prompt).toContain('Ask for an explicit budget before paid execution');
      expect(prompt).not.toContain('ignored=private');
      const urls = prompt.match(/https?:\/\/[^\s,]+\/docs\/raw\/[^\s,]+\.md/g) || [];
      expect(urls).toHaveLength(3);
      for (const target of urls) {
        const url = new URL(target);
        expect(url.origin).toBe(origin);
        expect(findPage(url.pathname.replace('/docs/raw/', '').replace(/\.md$/, ''))).toBeDefined();
      }
    },
  );
});
