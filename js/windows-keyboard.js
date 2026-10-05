// Send UTF-16 Unicode input directly. The bundled native typing library loses
// non-ASCII characters on Windows. This runs in the existing private helper.
function unicodeTypingScript(text) {
    if (typeof text !== 'string' || text.length > 100000) throw new Error('Invalid Unicode input');
    const literal = `'${text.replace(/'/g, "''")}'`;
    return `
if (-not ('AetheriaUnicodeInput' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class AetheriaUnicodeInput {
    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput {
        public int X, Y;
        public uint MouseData, Flags, Time;
        public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput {
        public ushort VirtualKey, ScanCode;
        public uint Flags, Time;
        public UIntPtr ExtraInfo;
    }
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion {
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public KeyboardInput Keyboard;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Input {
        public uint Type;
        public InputUnion Data;
    }
    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);
    public static void Type(string text) {
        var inputs = new Input[text.Length * 2];
        for (int index = 0; index < text.Length; index++) {
            inputs[index * 2] = new Input { Type = 1, Data = new InputUnion {
                Keyboard = new KeyboardInput { ScanCode = text[index], Flags = 4 }
            }};
            inputs[index * 2 + 1] = new Input { Type = 1, Data = new InputUnion {
                Keyboard = new KeyboardInput { ScanCode = text[index], Flags = 6 }
            }};
        }
        if (inputs.Length > 0 && SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input))) != inputs.Length) {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Unicode input could not be sent. Observe before retrying.");
        }
    }
}
'@
}
[AetheriaUnicodeInput]::Type(${literal})
`.trim();
}

module.exports = { unicodeTypingScript };
