# Realtime Text API

This document defines the placeholder contract for live transcription and live translation.
The ASR/translation backend is not connected yet.

## Feature flag owner

The realtime text API owns the UI flag. The player page does not decide from local props.
On page load, the UI calls the snapshot endpoint once; `enabled: true` in the response is the only normal condition that shows realtime text controls.

For the current placeholder implementation, the API derives that flag from per-player `streamConfig.realtimeText`:

```json
{
  "mode": "echo",
  "realtimeText": {
    "enabled": true,
    "mode": "both",
    "sourceLanguage": "ja-JP",
    "targetLanguage": "zh-CN",
    "subtitleOpacity": 0.78,
    "subtitleScale": 1,
    "transcriptPanel": true
  }
}
```

`mode` may be `subtitle`, `transcript`, or `both`.

## Snapshot endpoint

```http
GET /api/players/by-pid/:pid/realtime-text
```

Returns the latest lightweight snapshot for the player.
Debug UI may force the placeholder flag while the ASR interface is not ready:

```http
GET /api/players/by-pid/:pid/realtime-text?force=1
```

`force=1` is for GUI/debug preview only. It does not imply the ASR backend is connected.

```json
{
  "pId": "22-7",
  "enabled": true,
  "revision": null,
  "generatedAt": "2026-05-10T03:00:00.000Z",
  "config": {
    "enabled": true,
    "mode": "both",
    "sourceLanguage": "ja-JP",
    "targetLanguage": "zh-CN",
    "subtitleOpacity": 0.78,
    "subtitleScale": 1,
    "transcriptPanel": true
  },
  "partial": null,
  "segments": []
}
```

## SSE endpoint

```http
GET /api/players/by-pid/:pid/realtime-text/events
```

The current implementation emits one `snapshot` event and closes. Debug preview may use `?force=1`.
A future streaming backend may keep this open and emit:

```text
event: partial
data: {"id":"...","startMs":1200,"sourceText":"...","translatedText":"...","isFinal":false,"createdAt":"..."}

event: segment
data: {"id":"...","startMs":1200,"endMs":3400,"sourceText":"...","translatedText":"...","isFinal":true,"createdAt":"..."}
```

## Worker CPU guardrails

- Do not run ASR, decoding, model inference, or long polling in `live-player`.
- The Worker should only serve small snapshots or broker precomputed text events.
- Keep high-frequency audio capture, ASR, and translation in StreamServ or another backend.
- Prefer coarse updates and bounded payloads; avoid per-token fanout through this Worker.
