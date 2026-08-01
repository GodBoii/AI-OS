param(
    [string]$Language = "en-US"
)

$ErrorActionPreference = "Stop"

$source = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Speech.Recognition;
using System.Threading;
using System.Web.Script.Serialization;

namespace Aetheria.NativeSpeech
{
    public static class SpeechHost
    {
        private static readonly object OutputLock = new object();
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        private static void Emit(Dictionary<string, object> payload)
        {
            lock (OutputLock)
            {
                Console.Out.WriteLine(Serializer.Serialize(payload));
                Console.Out.Flush();
            }
        }

        private static RecognizerInfo SelectRecognizer(string requestedLanguage)
        {
            var installed = SpeechRecognitionEngine.InstalledRecognizers().ToList();
            if (installed.Count == 0)
            {
                Emit(new Dictionary<string, object> {
                    { "type", "error" },
                    { "code", "speech_runtime_unavailable" },
                    { "message", "Windows Speech Recognition is not installed." }
                });
                return null;
            }

            var requested = String.IsNullOrWhiteSpace(requestedLanguage) ? "en-US" : requestedLanguage.Trim();
            var prefix = requested.Split('-')[0];
            var selected = installed.FirstOrDefault(item =>
                String.Equals(item.Culture.Name, requested, StringComparison.OrdinalIgnoreCase));
            if (selected == null)
            {
                selected = installed.FirstOrDefault(item =>
                    String.Equals(item.Culture.TwoLetterISOLanguageName, prefix, StringComparison.OrdinalIgnoreCase));
            }

            if (selected == null)
            {
                Emit(new Dictionary<string, object> {
                    { "type", "error" },
                    { "code", "language_unavailable" },
                    { "message", "No installed Windows speech recognizer supports " + requested + "." },
                    { "availableLanguages", installed.Select(item => item.Culture.Name).ToArray() }
                });
            }
            return selected;
        }

        public static int Run(string requestedLanguage)
        {
            var selected = SelectRecognizer(requestedLanguage);
            if (selected == null) return 3;

            var completed = new ManualResetEvent(false);
            try
            {
                using (var recognizer = new SpeechRecognitionEngine(selected))
                {
                    recognizer.LoadGrammar(new DictationGrammar());
                    recognizer.SetInputToDefaultAudioDevice();

                    recognizer.SpeechHypothesized += (sender, args) =>
                    {
                        var text = args.Result == null ? "" : args.Result.Text;
                        if (!String.IsNullOrWhiteSpace(text))
                        {
                            Emit(new Dictionary<string, object> {
                                { "type", "interim" },
                                { "text", text }
                            });
                        }
                    };

                    recognizer.SpeechRecognized += (sender, args) =>
                    {
                        var text = args.Result == null ? "" : args.Result.Text;
                        if (!String.IsNullOrWhiteSpace(text))
                        {
                            Emit(new Dictionary<string, object> {
                                { "type", "result" },
                                { "text", text },
                                { "confidence", Math.Round(args.Result.Confidence, 4) }
                            });
                        }
                    };

                    recognizer.SpeechRecognitionRejected += (sender, args) =>
                    {
                        Emit(new Dictionary<string, object> {
                            { "type", "speech-rejected" }
                        });
                    };

                    recognizer.AudioStateChanged += (sender, args) =>
                    {
                        Emit(new Dictionary<string, object> {
                            { "type", "audio-state" },
                            { "state", args.AudioState.ToString() }
                        });
                    };

                    recognizer.AudioLevelUpdated += (sender, args) =>
                    {
                        Emit(new Dictionary<string, object> {
                            { "type", "audio-level" },
                            { "level", args.AudioLevel }
                        });
                    };

                    recognizer.RecognizeCompleted += (sender, args) =>
                    {
                        if (args.Error != null)
                        {
                            Emit(new Dictionary<string, object> {
                                { "type", "error" },
                                { "code", "recognition_failed" },
                                { "message", args.Error.Message }
                            });
                        }
                        Emit(new Dictionary<string, object> {
                            { "type", "end" },
                            { "cancelled", args.Cancelled }
                        });
                        completed.Set();
                    };

                    Emit(new Dictionary<string, object> {
                        { "type", "ready" },
                        { "language", selected.Culture.Name },
                        { "recognizer", selected.Description }
                    });

                    recognizer.RecognizeAsync(RecognizeMode.Multiple);
                    Emit(new Dictionary<string, object> {
                        { "type", "listening" },
                        { "language", selected.Culture.Name }
                    });

                    Console.In.ReadLine();
                    recognizer.RecognizeAsyncStop();
                    if (!completed.WaitOne(5000))
                    {
                        recognizer.RecognizeAsyncCancel();
                        completed.WaitOne(1000);
                    }
                }
                return 0;
            }
            catch (Exception error)
            {
                var message = error.Message ?? "Windows Speech Recognition failed.";
                var lower = message.ToLowerInvariant();
                var code = lower.Contains("audio") || lower.Contains("microphone")
                    ? "microphone_unavailable"
                    : "speech_runtime_unavailable";
                Emit(new Dictionary<string, object> {
                    { "type", "error" },
                    { "code", code },
                    { "message", message }
                });
                return 1;
            }
            finally
            {
                completed.Dispose();
            }
        }
    }
}
'@

try {
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @(
        "System.Speech",
        "System.Web.Extensions"
    )
    exit [Aetheria.NativeSpeech.SpeechHost]::Run($Language)
}
catch {
    $payload = @{
        type = "error"
        code = "speech_runtime_unavailable"
        message = [string]$_.Exception.Message
    } | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($payload)
    [Console]::Out.Flush()
    exit 1
}
