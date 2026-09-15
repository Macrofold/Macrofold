# Optional file memory

Give an agent a small set of editable files it can consult across conversations. This starter uses ordinary files and instructions; it is not a semantic memory API, a background indexer, or guaranteed recall.

## Start with three places

| Default path | Purpose | How the customer controls it |
| --- | --- | --- |
| `profile.md` | Confirmed preferences and durable context | Read or correct Markdown |
| `memory/` | Small notes by topic, with source, date and uncertainty | Inspect, edit or delete a note |
| `tasks.json` | Ongoing work, next action and provenance | Review task status or edit the JSON |

Use the [file-memory helper](../../../examples/shared/file-memory.ts) and the [personal-agent app](../../../examples/personal-agent/README.md) for a complete installation. The helper returns starter files, paths and instructions. It neither writes files nor changes permissions itself.

```ts
import { fileMemory } from './examples/shared/file-memory';

const memory = fileMemory();
// Or choose your own paths; none are mandatory platform filenames:
const custom = fileMemory({
  profile: 'customer/about.md', memories: 'notes', tasks: 'ongoing-work.json',
});
```

Install `memory.files` into a new, idle worktree using the SDK's conditional file writes, and append `memory.instructions` to the preset instructions. Use the returned path map in your editor. Do not reinstall a starter over existing customer content. Existing apps can choose to add only missing files after reviewing a preview. Checkpoints still follow normal persistence rules.

## What the instructions ask an agent to do

At the beginning of a task, read the profile and task file when present, then retrieve relevant topic notes. Save useful confirmed information with its source and date. Distinguish observations from inferences; ask about conflicting evidence instead of silently treating the latest text as truth. Keep credentials and unnecessary sensitive details out of memory.

Tasks use this editable schema:

```json
{
  "version": 1,
  "tasks": [{
    "id": "plan-weekend",
    "title": "Plan the weekend",
    "status": "waiting",
    "next_action": "Ask Alice to choose travel dates",
    "source": "Alice's request in the current conversation",
    "updated_at": "2026-09-10T12:00:00Z"
  }]
}
```

`status` is `open`, `waiting`, or `done`. Reuse task IDs across updates. The exported `taskFileSchema` validates the example editor and fixtures. The platform does not parse or execute `tasks.json`: use an explicit [schedule](../triggers/scheduled-tasks.md) to wake an agent.

## Inspect, correct and forget

1. Open the worktree's file browser or the reference app's memory editor.
2. Read the note and its sources. Update the preference or task; save against the revision you read.
3. If another writer changed the file, refresh and reconcile the conflict. Do not overwrite it automatically.
4. To forget, delete the relevant current note or remove the information from each affected current file. Start a fresh conversation when past chat text would otherwise reintroduce it.

Missing files are valid after deletion. Instructions explicitly discourage reviving forgotten information from old checkpoints or conversations. They guide model behavior; they cannot enforce privacy or reliable memory semantics. Current-file deletion does not erase retained checkpoints, historical run events or provider backups. Follow the [retention guide](../workspaces/README.md#retention-and-deletion) for those resources.

## Why files first

Files are inspectable, portable and already persistent. They work with separate conversations and specialist handoffs without another database or embedding service. The tradeoff is that retrieval, contradiction resolution and updates depend on instructions and model behavior. Large collections or stronger deletion/recall guarantees need an application-owned memory service with tested semantics. [Database recipes](../../../examples/integrations/README.md) demonstrate that boundary without making it mandatory.

Return to [customer-agent identity](README.md) for ownership and session decisions.
