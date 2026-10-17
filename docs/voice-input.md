# Voice input

The normal microphone records audio and sends it to the authenticated backend
at `POST /api/mic/dictate`. The backend calls Groq's transcription endpoint with
the fixed model `whisper-large-v3`. It returns the spoken text without an LLM
rewrite. Language detection is automatic. This replaces Windows speech recognition
for the normal mic and does not require installed Windows speech languages.

Click the normal mic to start recording, then click again to stop. The transcript
appears after transcription completes. Recording stops automatically at two minutes.
The upload limit is 8 MiB. Existing composer text is preserved, including edits made
while the request is pending. The waveform and processing states remain in place.
The normal mic and intelligent mic cannot run together. Starting a new chat,
switching chats, signing out, or closing the page cancels normal dictation and
prevents a late response from changing the composer.

The intelligent mic still uses `POST /api/mic/transcribe` and the existing
OpenRouter mic agent to resolve spoken self-corrections. Its recording behavior,
model configuration, and correction prompt have not changed.

## Server configuration

Set `GROQ_API_KEY` in the backend environment and deploy the updated backend before
using the updated desktop renderer. The endpoint returns 503 if the key is missing.
Keep this key on the server. The renderer sends the signed-in user's bearer token
to the Aetheria backend and never receives the Groq key.

The provider is **Groq**, not xAI's Grok. Groq offers free-plan access with account
rate limits. This implementation uses the key's existing plan, does not change
billing settings, and surfaces 429 responses without automatic retries or a paid
provider fallback. The app's existing subscription access checks also apply.

Provider references:

- [Speech-to-text API and supported models](https://console.groq.com/docs/speech-to-text)
- [Account rate limits](https://console.groq.com/docs/rate-limits)

## Verification

Run `npm run test:voice-input` for the waveform tests and a browser test using a real
MediaRecorder with Chromium's simulated microphone. It checks capture, appended
text, cancellation during capture startup and an in-flight request, provider errors,
sign-in checks, and the mic exclusion guard. Chrome or Edge must be installed, or
set `PUPPETEER_EXECUTABLE_PATH`.
The same browser check exercises the real composer state update and confirms the
intelligent mic still sends its WAV payload to its original endpoint.

Run `python -m pytest python-backend/tests/test_groq_dictation.py -q` with the backend
test dependencies installed. These tests cover the Groq multipart request, fixed
model, input limits, provider failures, malformed responses, authentication, and
subscription access failures. Provider calls use mocks and do not spend credits.

To check the deployed system, sign in, dictate into the normal mic, and confirm the
text appears when recording stops. Then use the intelligent mic with a spoken
self-correction and confirm its existing behavior. Real speech accuracy and live
Groq access require a configured backend and a physical microphone.
