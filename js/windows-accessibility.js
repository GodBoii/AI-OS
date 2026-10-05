// Each request resolves a live UIA element inside one explicit HWND.
// Runtime IDs are opaque references, never coordinates or traversal indexes.
const TYPES = {
    button: 'Button', edit: 'Edit', text: 'Text', link: 'Hyperlink',
    checkbox: 'CheckBox', radio: 'RadioButton', combobox: 'ComboBox',
    list: 'List', menu: 'MenuItem', tab: 'TabItem',
};
const ACTIONS = new Set(['invoke', 'focus', 'toggle', 'select', 'expand', 'collapse', 'set_value']);
const quote = value => `'${String(value).replace(/'/g, "''")}'`;

function buildScript({ windowId, elementType, text, limit = 200, runtimeId, action, value }) {
    if (!Number.isSafeInteger(windowId) || windowId <= 0) throw new Error('Invalid window ID');
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('limit must be between 1 and 500');
    if (elementType && !TYPES[elementType]) throw new Error('Unsupported element_type');
    if (action && !ACTIONS.has(action)) throw new Error('Unsupported accessibility action');
    if (action && (typeof runtimeId !== 'string' || !/^-?\d+(,-?\d+)*$/.test(runtimeId))) {
        throw new Error('Invalid accessibility runtime ID');
    }
    if (action === 'set_value' && typeof value !== 'string') throw new Error('value must be text');
    return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
try {
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${windowId})
    if (-not $root -or $root.Current.NativeWindowHandle -ne ${windowId}) { throw 'Target window is no longer available' }
    $queue = New-Object 'System.Collections.Generic.Queue[System.Windows.Automation.AutomationElement]'
    $queue.Enqueue($root)
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $results = New-Object 'System.Collections.Generic.List[object]'
    $visited = 0
    $discovered = 1
    $maxNodes = 2000
    $target = $null
    $truncated = $false
    while ($queue.Count -gt 0 -and $visited -lt $maxNodes) {
        $el = $queue.Dequeue()
        $visited++
        try {
            $current = $el.Current
            $rect = $current.BoundingRectangle
            $id = $el.GetRuntimeId() -join ','
            ${action ? `if ($id -eq ${quote(runtimeId)}) { $target = $el; break }` : ''}
            if (-not $current.IsOffscreen -and $rect.Width -gt 0 -and $rect.Height -gt 0 ${elementType ? `-and $current.ControlType.ProgrammaticName -eq ${quote(`ControlType.${TYPES[elementType]}`)}` : ''} ${text !== undefined ? `-and $current.Name -eq ${quote(text)}` : ''}) {
                $patterns = @($el.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName -replace 'PatternIdentifiers.Pattern$', '' })
                $entry = @{
                    Name = $current.Name; ControlType = $current.ControlType.ProgrammaticName
                    X = [int]($rect.X + $rect.Width / 2); Y = [int]($rect.Y + $rect.Height / 2)
                    Width = [int]$rect.Width; Height = [int]$rect.Height
                    Left = $rect.X; Top = $rect.Y; IsEnabled = $current.IsEnabled
                    IsOffscreen = $current.IsOffscreen; IsFocused = $current.HasKeyboardFocus
                    AutomationId = $current.AutomationId; RuntimeId = $id; Patterns = $patterns
                    IsPassword = $current.IsPassword
                }
                if (-not $current.IsPassword) {
                    $vp = $null
                    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
                        $fullValue = $vp.Current.Value
                        $entry.Value = $fullValue.Substring(0, [Math]::Min(4000, $fullValue.Length))
                        $entry.ValueTruncated = $fullValue.Length -gt 4000
                        $entry.IsReadOnly = $vp.Current.IsReadOnly
                    }
                    $tp = $null
                    if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$tp)) { $entry.ToggleState = $tp.Current.ToggleState.ToString() }
                    $sp = $null
                    if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$sp)) { $entry.IsSelected = $sp.Current.IsSelected }
                    $ep = $null
                    if ($el.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$ep)) { $entry.ExpandCollapseState = $ep.Current.ExpandCollapseState.ToString() }
                    if ($current.HasKeyboardFocus -or $current.ControlType -eq [System.Windows.Automation.ControlType]::Document) {
                        $textPattern = $null
                        if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$textPattern)) {
                            $entry.Text = $textPattern.DocumentRange.GetText(8000)
                            $entry.SelectedText = @($textPattern.GetSelection() | ForEach-Object { $_.GetText(2000) }) -join [Environment]::NewLine
                        }
                    }
                }
                $results.Add($entry)
                if ($results.Count -ge ${limit}) { $truncated = $true; break }
            }
            $child = $walker.GetFirstChild($el)
            while ($child -and $discovered -lt $maxNodes) {
                $queue.Enqueue($child)
                $discovered++
                $child = $walker.GetNextSibling($child)
            }
            if ($child) { $truncated = $true }
        } catch [System.Windows.Automation.ElementNotAvailableException] { }
    }
    ${action ? `
    if (-not $target) { throw 'Element is stale or no longer belongs to the target window. Observe again.' }
    if ($target.Current.IsOffscreen -or -not $target.Current.IsEnabled) { throw 'Element is offscreen or disabled' }
    if ($target.Current.IsPassword) { throw 'Password controls are excluded from accessibility actions' }
    $pattern = $null
    switch (${quote(action)}) {
        'focus' { $target.SetFocus() }
        'invoke' {
            if (-not $target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { throw 'Invoke unavailable. Use a fresh screenshot and coordinate click.' }
            $pattern.Invoke()
        }
        'toggle' {
            if (-not $target.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) { throw 'Toggle unavailable' }
            $pattern.Toggle()
        }
        'select' {
            if (-not $target.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) { throw 'Select unavailable' }
            $pattern.Select()
        }
        { $_ -in 'expand', 'collapse' } {
            if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) { throw 'Expand/collapse unavailable' }
            if ($_ -eq 'expand') { $pattern.Expand() } else { $pattern.Collapse() }
        }
        'set_value' {
            if (-not $target.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { throw 'Set value unavailable. Focus the field and type instead.' }
            if ($pattern.Current.IsReadOnly) { throw 'Element is read-only' }
            $pattern.SetValue(${quote(value ?? '')})
            $deadline = [DateTime]::UtcNow.AddMilliseconds(750)
            while ($pattern.Current.Value -ne ${quote(value ?? '')} -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 25 }
            if ($pattern.Current.Value -ne ${quote(value ?? '')}) { throw 'Value update could not be verified. Observe before retrying.' }
        }
    }
    @{ status = 'success'; action = ${quote(action)}; input_sent = $true } | ConvertTo-Json -Compress
    ` : `
    $bounds = $root.Current.BoundingRectangle
    @{ status = 'success'; elements = @($results.ToArray()); visited = $visited
       truncated = ($truncated -or $queue.Count -gt 0)
       window_id = ${windowId}; coordinate_space = 'screen_physical'
       bounds = @{ x = $bounds.X; y = $bounds.Y; width = $bounds.Width; height = $bounds.Height }
    } | ConvertTo-Json -Depth 6 -Compress
    `}
} catch {
    @{ status = 'error'; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`.trim();
}

module.exports = { buildScript, ACTIONS };
