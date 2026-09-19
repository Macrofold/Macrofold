"""Adapt the pinned, unmodified Hermes agent core to the native worker protocol."""
import contextlib
import asyncio
import json
import os
from pathlib import Path
import queue
import signal
import sys
import threading
import uuid

wire = sys.stdout
lock = threading.Lock()
answers = queue.Queue()
turns = queue.Queue(maxsize=1)


def send(message):
    with lock:
        wire.write(json.dumps(message) + "\n")
        wire.flush()


def emit(kind, **data):
    send({"type": "event", "event": {"type": kind, "data": data}})


def clarify(question, choices=None):
    request_id = str(uuid.uuid4())
    send({"type": "input", "id": request_id, "question": question,
          "details": {"choices": choices or []}})
    while True:
        reply = answers.get()
        if reply.get("id") == request_id:
            answer = reply.get("answer", {})
            return str(answer.get("text", answer.get("answer", "")))


def read_answers():
    for line in sys.stdin:
        message = json.loads(line)
        (turns if 'runId' in message else answers).put(message)
    turns.put(None)


def register_file_tools(url, token):
    """Use Hermes' native tool registry with the shared checked MCP service.

    The pinned generic MCP handler counts tool denials as transport failures and
    disconnects after three. Keep error results intact without that retry loop;
    every call here is a single SDK request, with no replay of file mutations.
    """
    import httpx2
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from tools.registry import registry

    async def request(arguments=None):
        async with httpx2.AsyncClient(headers={"Authorization": "Bearer " + token}, timeout=30) as http:
            async with streamable_http_client(url, http_client=http) as streams:
                async with ClientSession(*streams) as session:
                    await session.initialize()
                    return await session.list_tools() if arguments is None else await session.call_tool(
                        "worktree_files", arguments)

    tools = asyncio.run(request()).tools
    if len(tools) != 1 or tools[0].name != "worktree_files":
        raise RuntimeError("Checked file service unavailable")
    tool = tools[0]

    def execute(args, **kwargs):
        result = asyncio.run(request(args))
        text = "\n".join(block.text for block in result.content if block.type == "text")
        return json.dumps({"error" if result.is_error else "result": text})

    registry.register(name=tool.name, toolset="worktree", handler=execute,
                      schema={"name": tool.name, "description": tool.description,
                              "parameters": tool.input_schema})


def main():
    c = json.loads(sys.stdin.readline())
    home = Path(os.environ["HERMES_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    # Config is rebuilt for every launch and excluded from portable checkpoints.
    # The only credential is the run capability; vendor keys stay at the gateway.
    route = {"provider": "custom", "model": c["model"],
             "base_url": c["gatewayURL"] + "/v1", "api_key": c["token"]}
    config = {"model": {**route, "default": c["model"], "context_length": 128000},
              "fallback_providers": [], "streaming": True,
              "auxiliary": {"compression": route, "background_review": {"enabled": False}},
              "terminal": {"backend": "local", "cwd": c["workspace"]},
              "mcp_servers": {}}
    if c["toolGrants"]:
        config["mcp_servers"]["platform"] = {
            "url": c["toolURL"], "headers": {"Authorization": "Bearer " + c["token"]},
            "sampling": {"enabled": False},
        }
    config_path = home / "config.yaml"
    guarded = bool(os.environ.get("PLATFORM_FILE_TOOL_URL"))
    config_path.write_text(json.dumps(config))
    config_path.chmod(0o600)
    # Imports and tool libraries may print diagnostics; stdout belongs to JSONL.
    from run_agent import AIAgent
    from hermes_state import SessionDB
    from tools.mcp_tool_discovery import register_mcp_servers
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    db = SessionDB(home / "state.db")
    session_id = c.get("resumeId") or str(uuid.uuid4())
    if c.get("resumeId") and not db.get_session(session_id):
        raise ValueError("Hermes session checkpoint missing")
    history = db.get_messages_as_conversation(session_id, include_ancestors=True) if c.get("resumeId") else None
    if c.get("resumeId") and not history:
        raise ValueError("Hermes session conversation missing")
    toolsets = ["clarify"] if guarded else ["terminal", "file", "skills", "memory", "clarify"]
    if guarded:
        register_file_tools(os.environ["PLATFORM_FILE_TOOL_URL"], os.environ["PLATFORM_FILE_TOOL_TOKEN"])
        toolsets.append("worktree")
    if config["mcp_servers"]:
        if not register_mcp_servers(config["mcp_servers"]):
            raise RuntimeError("Authorized MCP broker unavailable")
        toolsets.extend("mcp-" + name for name in config["mcp_servers"])
    agent = AIAgent(
        **route, api_mode="chat_completions", max_tokens=8192,
        session_id=session_id, session_db=db, enabled_toolsets=toolsets,
        quiet_mode=True, skip_background_review=True, fallback_model=[],
        ephemeral_system_prompt=c.get("instructions"),
        stream_delta_callback=lambda text: emit("output.delta", text=text),
        tool_start_callback=lambda ident, name, args: emit(
            "tool.started", tool_call_id=ident, name=name, arguments=args),
        tool_complete_callback=lambda ident, name, args, result: emit(
            "tool.completed", tool_call_id=ident, name=name, result=result),
        clarify_callback=clarify,
    )
    signal.signal(signal.SIGTERM, lambda *_: agent.interrupt(hard_cancel=True))
    threading.Thread(target=read_answers, daemon=True).start()
    try:
        reused = False
        while c is not None:
            emit("runtime.started", harness="hermes", native_session_id=session_id, reused=reused)
            result = agent.run_conversation(user_message=c["prompt"], conversation_history=history)
            outcome = "cancelled" if result.get("interrupted") else (
                "success" if result.get("completed") and not result.get("error") else "failure")
            send({"type": "result", "result": {
                "output": result.get("final_response") or "", "resumeId": agent.session_id,
                "outcome": outcome, **({"failureCode": "harness_error"} if outcome == "failure" else {}),
            }})
            if not c.get("warm") or outcome != "success":
                break
            history = result["messages"]
            c = turns.get()
            reused = True
    finally:
        agent.close()
        shutdown_mcp_servers()
        db.close()


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        main()
