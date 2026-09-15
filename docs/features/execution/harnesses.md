# Choose an agent harness

A harness is the agent software that plans work, calls tools, and edits files. A model supplies its reasoning. Macrofold runs the harness in an isolated environment and preserves the project's files between tasks.

The [Unified Harness Interface (UHI)](unified-harness-interface.md) gives each harness the same Macrofold run operations while preserving its native behavior. Anyone can [contribute another harness](unified-harness-interface.md#contribute-a-harness) by implementing the interface and its integration tests.

## Available harnesses

| Harness          | API value     | Model routes                  | Native tools                                |
| ---------------- | ------------- | ----------------------------- | ------------------------------------------- |
| Codex            | `codex`       | OpenAI                        | Codex coding tools                          |
| Claude Code      | `claude-code` | Anthropic                     | Claude Code coding tools                    |
| OpenCode         | `opencode`    | OpenAI, Anthropic, OpenRouter | OpenCode coding tools                       |
| Hermes           | `hermes`      | OpenAI, OpenRouter            | Shell, files, skills, memory, clarification |
| DeepSeek Harness | `deepseek`    | OpenAI, OpenRouter            | Persistent Bash and file editor             |
| Pi               | `pi`          | OpenAI, OpenRouter            | Read, Bash, edit, write                     |

All six use the same project files, run budgets, cancellation endpoint, historical events, and granted connector tools. The [model catalog](models.md) lists the enabled combinations for your deployment. A harness name does not imply that every model or authentication method supported by its upstream project is available in Macrofold.

**DeepSeek Harness is agent software, separate from DeepSeek's models.** This integration uses its official minimal runtime profile and Macrofold's reviewed model routes. It does not enable a direct DeepSeek model provider or require a DeepSeek API key.

## Start a run

In the dashboard, choose **New run → Harness**, then select an available model. Save an **Agent preset** to reuse that configuration with triggers, the API, or the CLI.

For Python, set `MACROFOLD_API_KEY` and use your project ID:

```python
from macrofold import Macrofold

macrofold = Macrofold()
run = macrofold.runs.create(
    project_id="YOUR_PROJECT_ID",
    harness="hermes",  # Or "deepseek" or "pi"
    model="gpt-5.4-mini",
    billing_mode="managed",
    prompt="Create hello.txt containing Hello world.",
)
for text in macrofold.runs.stream_text(run.run_id):
    print(text, end="", flush=True)
```

All [five SDKs](../api/sdks/README.md) expose these harness values through their generated request types. The request, result, file-reading, and streaming methods are identical across harnesses. Use an enabled model returned by `models.list()`; managed inference consumes credits. See [BYOK](../billing/README.md) to select your own model connection.

From a [linked terminal project](../cli/README.md):

```sh
macrofold run "Create hello.txt containing Hello world." --harness pi --model gpt-5.4-mini
```

## Continue and observe

Continue the returned session to reuse both its conversation and the latest verified workspace files. Native state stays with its session: Hermes retains its session database, skills, and memory; DeepSeek retains its session logs; Pi retains its conversation files. Starting another harness creates a new conversation over the same workspace rather than translating another harness's history.

Hermes and Pi stream assistant text as it arrives. The DeepSeek adapter publishes text when each assistant message commits; tool events appear as work progresses. `stream_text()` handles the same normalized stream for every harness and excludes tool payloads and private reasoning. Use `runs.events()` for structured activity or `runs.wait()` for the final result.

Cancelling a run stops its native process and saves recoverable files. It does not undo completed tools. Closing a stream only detaches. DeepSeek cancellation stops its supervised native process.

## Tools and isolation

Select authorized connection IDs and tool grants on your preset or run. Macrofold's broker rechecks authorization and spending before external calls. Native browser/search services and additional model routes are not implicitly enabled; configure [web search](../identity-integrations/web-search.md) or other connectors through Macrofold.

Vendor API keys remain in the application gateway. Harnesses receive a short-lived run capability. Native authentication and temporary launch configuration are excluded from project checkpoints. Skills and local shell commands still run as agent code inside the sandbox; file permissions are not a separate security boundary between tools using the same account.

## Try locally

The [local simulation guide](../../getting-started/local-development/simulation.md) works with every harness selection using `fixture-model` and makes no inference calls. Simulation tests the Macrofold workflow; it does not execute the native harness.

Use [local Docker](../../getting-started/local-development/docker.md) to execute the real harnesses without Vercel. The shared runtime image includes all six, so no separate installation is needed on your host. Free deterministic native tests use scripted model responses and disabled networking:

```sh
pnpm test:native hermes deepseek pi
```

Real model reasoning requires an enabled provider route, a key, and an explicitly chosen budget. See [cloud staging](../../getting-started/local-development/cloud.md) for hosted acceptance.

## Upstream projects

- [Hermes Agent](https://github.com/NousResearch/hermes-agent) and its [programmatic interfaces](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration).
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its [agent embedding API](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/core/agent). Its developer-preview interface is pinned in the runtime image.
- [Pi](https://github.com/badlogic/pi-mono) and its [SDK](https://pi.dev/docs/latest/sdk).
