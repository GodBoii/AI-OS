// Build the same ordered activity blocks for stored native events and desktop replay.
export function activityInvocationId(event) {
    if (event.invocation_id) return event.invocation_id;
    const nativeId = event.tool_call_id || event.tool?.tool_call_id;
    return nativeId ? JSON.stringify([String(event.delegation_id || ''), event.agent_name || event.team_name || 'Assistant', String(nativeId)]) : null;
}

export function buildActivityTimeline(events = [], primaryOwner = 'Aetheria_AI') {
    const entries = [];
    const calls = new Map();
    const delegations = new Map();
    const seen = new Set();
    const pending = [];
    const responses = [];
    let response = '';
    let legacyId = 0;
    const ordered = (Array.isArray(events) ? events : []).filter(event => event && typeof event === 'object');
    if (ordered.length && ordered.every(event => Number.isFinite(event.sequence))) {
        ordered.sort((a, b) => a.sequence - b.sequence);
    }
    const appendText = (kind, text, event) => {
        if (!text) return;
        const owner = event.agent_name || event.team_name || 'Assistant';
        const previous = entries.at(-1);
        if (previous?.kind === kind && previous.owner === owner && previous.delegationId === event.delegation_id) {
            previous.content += text;
        } else {
            entries.push({ kind, content: String(text), owner, delegationId: event.delegation_id });
        }
    };
    for (const event of ordered) {
        if (event.event_id && seen.has(event.event_id)) continue;
        if (event.event_id) seen.add(event.event_id);
        const channel = event.channel || event.type || event.event;
        const kind = event.step_type || event.type || event.event;
        const tool = event.tool || {};
        const name = event.name || tool.tool_name || 'Unknown Tool';
        const owner = event.agent_name || event.team_name || 'Assistant';
        const delegatedResponse = Boolean(event.delegation_id)
            || Boolean((event.is_log || event.event) && owner !== primaryOwner);
        const start = kind === 'tool_start' || ['ToolCallStarted', 'TeamToolCallStarted'].includes(event.event);
        const end = kind === 'tool_end' || ['ToolCallCompleted', 'TeamToolCallCompleted'].includes(event.event);
        if (channel === 'assistant_response_reset') {
            if (response) responses.push(response);
            response = '';
        } else if (kind === 'delegation_start' || kind === 'delegation_end') {
            let entry = delegations.get(event.delegation_id);
            if (!entry) {
                entry = { kind: 'delegation', id: event.delegation_id, owner,
                    name: event.delegated_agent || 'Agent', content: event.task_description || '', status: 'running' };
                entries.push(entry);
                delegations.set(event.delegation_id, entry);
            }
            if (kind === 'delegation_end') entry.status = event.success === false ? 'failed' : 'completed';
        } else if (start || end) {
            if (start && response) {
                responses.push(response);
                response = '';
            }
            let id = activityInvocationId(event);
            if (!id && end) {
                id = pending.find(key => {
                    const entry = calls.get(key);
                    return entry.name === name && entry.owner === owner && entry.delegationId === event.delegation_id;
                });
            }
            id = id || `legacy-${++legacyId}`;
            let entry = calls.get(id);
            if (!entry) {
                entry = { kind: 'tool', id, name, owner, delegationId: event.delegation_id, tool, status: 'in-progress' };
                entries.push(entry);
                calls.set(id, entry);
                pending.push(id);
            }
            if (end) {
                entry.tool = tool;
                entry.status = tool.tool_call_error || tool.tool_output?.ok === false ? 'failed' : 'completed';
                const index = pending.indexOf(id);
                if (index >= 0) pending.splice(index, 1);
            }
        } else if (channel === 'computer_tool_result_preview') {
            const entry = calls.get(activityInvocationId(event));
            if (entry) entry.metadata = event.metadata;
        } else if (channel === 'reasoning_step' || channel === 'reasoning-step' || (event.reasoning_content && !event.reasoning_emitted)
            || ['ReasoningStep', 'TeamReasoningStep'].includes(event.event)) {
            appendText('reasoning', event.step || event.reasoning_content || event.content_for_reasoning
                || event.reasoning_step || '', event);
            if (event.content && ['response', 'RunContent', 'TeamRunContent'].includes(channel)) {
                if (delegatedResponse) appendText('message', event.content, event);
                else response += event.content;
            }
        } else if (channel === 'response' || channel === 'plan_response' || ['RunContent', 'TeamRunContent'].includes(event.event)) {
            if (delegatedResponse) appendText('message', event.content, event);
            else response += event.content || '';
        } else if (event.event === 'RunCompleted' && owner !== primaryOwner) {
            appendText('message', event.content, event);
        }
    }
    return { entries, response, responses };
}
