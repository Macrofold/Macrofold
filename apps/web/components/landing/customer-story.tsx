import Link from 'next/link';
import { ArrowRight, Check, Clock3, Folder, MessagesSquare, Users } from 'lucide-react';
import './customer-story.css';

const steps = [
  {
    icon: MessagesSquare,
    title: 'Monday: meet Milo',
    text: 'Alice shares her preferences with her personal agent.',
  },
  {
    icon: Users,
    title: 'Tuesday: bring in a specialist',
    text: 'A research agent reads the saved brief in a fresh conversation.',
  },
  {
    icon: Clock3,
    title: 'Friday: follow up on schedule',
    text: 'Milo uses the latest files to prepare Alice’s weekly plan.',
  },
] as const;

export function CustomerStory() {
  return (
    <section className="mf-section mf-customer-story" aria-labelledby="customer-story-heading">
      <div className="mf-section-heading">
        <h2 className="mf-gleam" id="customer-story-heading">
          The conversation changes.
          <br />
          Their information stays.
        </h2>
        <p>
          Give every customer a persistent agent—with its own files, tools, and ongoing work. Let different
          agents build on those files over time.
        </p>
      </div>
      <div className="mf-customer-flow">
        <div className="mf-customer-files">
          <Folder size={30} aria-hidden="true" />
          <h3>Alice’s project files</h3>
          <span>One customer. One lasting source of context.</span>
          <code>profile.md</code>
          <code>memory/travel.md</code>
          <code>tasks.json</code>
          <p>Optional starter layout · ordinary, editable files</p>
        </div>
        <ol>
          {steps.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Icon size={21} aria-hidden="true" />
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
          <li className="mf-customer-result">
            <Check size={21} aria-hidden="true" />
            <div>
              <h3>weekly-plan.md updated</h3>
              <p>Alice opens the result and corrects a preference for next time.</p>
            </div>
          </li>
        </ol>
      </div>
      <p className="mf-customer-note">
        Customer agents is an optional integration path over Macrofold’s projects, worktrees, presets and
        runs. Your app owns customer identity. This illustrative workflow uses ordinary files and separate
        conversations; the optional memory starter guides what agents save.
      </p>
      <Link className="mf-text-link" href="/docs/customer-agents">
        Build this customer experience <ArrowRight size={15} />
      </Link>
    </section>
  );
}
