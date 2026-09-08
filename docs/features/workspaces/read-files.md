# Read persisted files

Read a file by its workspace-relative path to retrieve an agent's saved work from your application. The API returns the complete file bytes, including empty and binary files, rather than a preview or a JSON wrapper.

## Read after a run

A run's `workspace_id` identifies the files it edited. Wait for execution and persistence to finish before reading the result:

```python
from macrofold import Macrofold

client = Macrofold()  # Uses MACROFOLD_API_KEY
try:
    run = client.runs.create(
        project_id="YOUR_PROJECT_ID",
        agent_id="YOUR_AGENT_ID",
        prompt="Create hello.txt containing Hello world.",
    )
    client.runs.wait(run.run_id)
    content = client.workspaces.read_file(run.workspace_id, path="hello.txt")
    print(content.decode("utf-8"))
finally:
    client.close()
```

The saved agent preset supplies the harness, model, and billing configuration. For an existing run, use `client.runs.get(run_id).workspace_id`. To read a project's main files without a run, use `client.projects.get(project_id).default_workspace_id`. Select the specific workspace when working on another branch.

During execution, reads return the **last published revision**. They do not inspect the running agent's mutable filesystem. `runs.wait` includes checkpoint persistence; optional Git synchronization is separate. A later run or edit can publish another revision before your read, so this endpoint reads current workspace content rather than a snapshot pinned to a particular run.

## HTTP endpoint

```sh
curl --fail --silent --show-error --get \
  'https://app.macrofold.ai/v1/workspaces/YOUR_WORKSPACE_ID/file' \
  --header "Authorization: Bearer $MACROFOLD_API_KEY" \
  --data-urlencode 'path=reports/summary.md' \
  --output summary.md
```

Use your local, staging, or self-hosted origin when appropriate. The key needs `files:read` and access to the workspace's project. Paths are relative to the workspace root; pass the original path to an SDK and let it handle URL encoding.

Successful responses use `application/octet-stream`, attachment disposition, and an `ETag` containing the observed workspace revision. Decode text using its known encoding; keep bytes for images, archives, and other binary content. Empty files return HTTP 200 with zero bytes. File contents are private and are not cached by the API.

## SDK methods

All five SDKs expose the same endpoint through generated resource methods:

| Language                                                             | Method                                                                                       | Result                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [Python](../../../sdk/python/README.md#read-persisted-files)         | `client.workspaces.read_file(workspace_id, path="hello.txt")`                                | `bytes`                                                    |
| [TypeScript](../../../sdk/typescript/README.md#read-persisted-files) | `client.workspaces.readFile(workspaceId, { path: "hello.txt" })`                             | `Uint8Array`                                               |
| [Go](../../../sdk/go/README.md#read-persisted-files)                 | `client.Workspaces.ReadFile(ctx, workspaceID, &macrofold.ReadFileParams{Path: "hello.txt"})` | Temporary `*os.File`; close and remove after reading       |
| [Rust](../../../sdk/rust/README.md#read-persisted-files)             | `client.workspaces().read_file(workspace_id, params).await`                                  | Response; consume with `.bytes().await` or `.text().await` |
| [Java](../../../sdk/java/README.md#read-persisted-files)             | `client.workspaces().readFile(workspaceId, new Resources.ReadFileParams("hello.txt"))`       | Temporary `File`; delete after reading                     |

See the linked language guides for executable-context examples and [API conventions](../api/README.md) for errors and authentication.

## Limits and errors

Direct reads return the entire file up to **4 MiB**. Larger files receive HTTP 413 before their content is loaded; responses are never silently truncated. To download a larger file, request the same endpoint with `download=true`. It returns HTTP 302 with a short-lived private download URL in `Location`. Fetch that URL separately without the Macrofold Authorization header. SDK clients deliberately refuse automatic redirects; use an HTTP client configured to expose the redirect response, or a [pull transfer](../cli/README.md).

| Response | Meaning                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------- |
| 400      | Missing or unsafe path, including traversal, absolute paths, or reserved platform directories   |
| 401      | Missing, expired, or revoked credentials                                                        |
| 403      | Missing file-read scope                                                                         |
| 404      | File or workspace is unavailable, including a workspace outside the credential's project access |
| 409      | Path is a symlink; read its target explicitly                                                   |
| 413      | File exceeds the direct-read limit; use a download or transfer                                  |

Direct reads verify stored content before returning it. If a streaming download fails, discard any partial local file. Reading does not modify the workspace or start an agent. Browse available paths with the file-listing resource, or return to [workspaces and Git](README.md).
