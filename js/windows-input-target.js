// Physical-pixel hit testing for gestures explicitly bound to one Windows HWND.
function buildPointerTargetScript(windowId, points) {
    if (!Number.isSafeInteger(windowId) || windowId <= 0) throw new Error('Invalid window_id');
    if (!Array.isArray(points) || points.length < 1 || points.length > 2 || points.some(point =>
        !Number.isInteger(point.x) || !Number.isInteger(point.y) ||
        point.x < -2147483648 || point.x > 2147483647 || point.y < -2147483648 || point.y > 2147483647)) {
        throw new Error('Target points must be signed 32-bit integer pixels');
    }
    return `
if (-not ('AetheriaPointerTarget' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AetheriaPointerTarget {
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
}
$previousDpi = [AetheriaPointerTarget]::SetThreadDpiAwarenessContext([IntPtr](-4))
try {
    if ($previousDpi -eq [IntPtr]::Zero) { throw 'Physical-pixel hit testing is unavailable' }
    $hwnd = [IntPtr]${windowId}
    if (-not [AetheriaPointerTarget]::IsWindow($hwnd)) { throw 'Target window is no longer available' }
    if ([AetheriaPointerTarget]::GetForegroundWindow() -ne $hwnd) { throw 'Target lost foreground focus before input' }
    $rect = New-Object AetheriaPointerTarget+Rect
    if (-not [AetheriaPointerTarget]::GetWindowRect($hwnd, [ref]$rect)) { throw 'Target window bounds are unavailable' }
    ${points.map(point => `
    $point = New-Object AetheriaPointerTarget+Point
    $point.X = ${point.x}; $point.Y = ${point.y}
    if ($point.X -lt $rect.Left -or $point.X -ge $rect.Right -or $point.Y -lt $rect.Top -or $point.Y -ge $rect.Bottom) {
        throw 'Point is outside the target window'
    }
    $hit = [AetheriaPointerTarget]::WindowFromPoint($point)
    if ($hit -eq [IntPtr]::Zero -or [AetheriaPointerTarget]::GetAncestor($hit, 2) -ne $hwnd) {
        throw 'Point is covered by another window. Observe and target that window explicitly.'
    }
    `).join('\n')}
    @{ status = 'success' } | ConvertTo-Json -Compress
} catch {
    @{ status = 'error'; error = $_.Exception.Message; outcome = 'not_executed' } | ConvertTo-Json -Compress
} finally {
    if ($previousDpi -ne [IntPtr]::Zero) { [void][AetheriaPointerTarget]::SetThreadDpiAwarenessContext($previousDpi) }
}
`.trim();
}

module.exports = { buildPointerTargetScript };
