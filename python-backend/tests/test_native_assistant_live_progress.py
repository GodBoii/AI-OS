from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT = BACKEND_DIR.parent
ANDROID_JAVA = ROOT / "android/app/src/main/java/com/aetheria/ai"
ANDROID_RES = ROOT / "android/app/src/main/res"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_android_bridge_forwards_reasoning_events_to_the_session():
    bridge = _read(ANDROID_JAVA / "AssistantMobileBridgeManager.java")
    session = _read(ANDROID_JAVA / "AssistantSession.java")

    assert "onAssistantReasoningStep" in bridge
    assert 'socket.on("reasoning_step"' in bridge
    assert "onAssistantReasoningStep" in session


def test_live_progress_keeps_the_response_card_visible_during_a_run():
    session = _read(ANDROID_JAVA / "AssistantSession.java")
    ui_manager = _read(ANDROID_JAVA / "AssistantUIManager.java")

    assert "showWorkingResponse" in session
    assert "showIntermediateResponse" in session
    assert "public void showWorkingResponse()" in ui_manager


def test_live_progress_is_visible_and_tool_resets_do_not_overwrite_agent_text():
    session = _read(ANDROID_JAVA / "AssistantSession.java")
    ui_manager = _read(ANDROID_JAVA / "AssistantUIManager.java")

    reset_handler = session.split(
        "public void onAssistantResponseReset", 1
    )[1].split(
        "public void onAssistantReasoningStep", 1
    )[0]
    tool_handler = session.split(
        "public void onAssistantToolStep", 1
    )[1].split(
        "public void onAssistantRunStatus", 1
    )[0]

    assert "setVisibility(View.VISIBLE)" in ui_manager
    assert "showWorkingResponse" not in reset_handler
    assert "showWorkingResponse" not in tool_handler
    assert "REASONING_STATUS_THROTTLE_MS = 1500L" in session
    assert "PROGRESS_TOOL_HOLD_MS = 1200L" in session


def test_new_chat_control_starts_a_fresh_conversation():
    layout = _read(ANDROID_RES / "layout/assistant_overlay.xml")
    ui_manager = _read(ANDROID_JAVA / "AssistantUIManager.java")
    session = _read(ANDROID_JAVA / "AssistantSession.java")
    bridge = _read(ANDROID_JAVA / "AssistantMobileBridgeManager.java")

    assert 'android:id="@+id/new_chat_btn"' in layout
    assert 'app:layout_constraintTop_toBottomOf="@+id/circle_search_btn"' in layout
    assert "void onNewChatRequested();" in ui_manager
    assert "onNewChatRequested()" in session
    assert "startNewConversation()" in session
    assert "Assistant request is no longer active." in bridge


def test_backend_writes_a_privacy_safe_run_completion_summary():
    runner = _read(BACKEND_DIR / "agent_runner.py")

    assert "[AGENT_RUNNER] COMPLETED RUN" in runner
    assert "content_chunks=%s" in runner
    assert "reasoning_events=%s" in runner
    assert "tool_calls=%s" in runner


def test_verbose_debug_is_enabled_only_for_the_android_system_assistant():
    config = _read(BACKEND_DIR / "config.py")
    runner = _read(BACKEND_DIR / "agent_runner.py")

    assert 'os.getenv("SYSTEM_ASSISTANT_DEBUG_MODE", "true")' in config
    assert "debug_mode=config.SYSTEM_ASSISTANT_DEBUG_MODE" in runner
    assert "llm_os_config.setdefault(\"debug_mode\", config.AGNO_DEBUG_MODE)" in runner
