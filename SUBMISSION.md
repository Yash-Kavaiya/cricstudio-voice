# CricStudio Voice: AssemblyAI Voice Hackathon submission

**One-liner:** Turn any live cricket match into a captioned, commentated broadcast that you can talk back to. Every voice and language feature runs on AssemblyAI.

- **Demo video (3:02):** [docs/cricstudio_voice_demo.mp4](docs/cricstudio_voice_demo.mp4) · YouTube link: _TBD_
- **Live demo:** https://cricstudio-voice.vercel.app
- **Code:** https://github.com/Yash-Kavaiya/cricstudio-voice
- **Real broadcasts made with the base studio:** https://www.youtube.com/@HappyLifeME/streams

## The problem
Every week thousands of matches (domestic first-class, women's leagues, associate nations) have a ball-by-ball data feed but **no commentary, no captions and no broadcast**. Fans are left with a silent scorecard, and blind or low-vision fans get nothing at all.

## What it does
- **AI commentator:** writes a grounded line for each boundary, wicket and milestone straight from the live scorecard, speaks it, and mixes it into the stream.
- **Talk to the commentator:** hold to ask ("What's the required rate?"). The agent calls a `get_match_state` tool and answers out loud. You can interrupt it mid-answer.
- **Realtime live captions** for the host and guests, burned into the stream, with player names boosted for accuracy.
- **Hands-free producer:** say "Studio, show the batting card" or "Studio, give me a recap".
- **Studio recaps** read on air, plus commentary in 13 languages.
- All of this runs inside the full CricStudio broadcast studio: 40 scenes, overlays, autopilot, and multistreaming to YouTube, Facebook, X and Twitch.

## AssemblyAI products used
| Product | Used for |
| --- | --- |
| **Voice Agent API** (streaming STT, LLM, TTS, tool calling, single-use tokens) | Talk-to-the-commentator, plus the commentator's on-air voice (11 voices) |
| **Universal-Streaming v3** (keyterms, formatted turns) | Realtime captions and voice commands |
| **LLM Gateway** (chat completions with model fallback) | Commentary writing, recaps, translation, voice-command intent parsing |
| **Async STT** (upload + transcript, keyterms) | Phrase transcription and key check |

The API key never reaches the browser; browsers only get short-lived tokens. If AssemblyAI is unreachable, the studio falls back to templates and an offline voice, so the show never goes silent.

## Previous work / real-world usage
The base studio, CricStudio, has already run real broadcasts on Yash's channel [Happy Life](https://www.youtube.com/@HappyLifeME/streams): **50 live streams, 14,949 views and about 63.7 hours live between 6 and 18 Oct 2026**. Those streams covered Ranji Trophy, IND vs WI T20Is, CWC League 2 and international ODIs. The top stream, [CAN vs NEP: Live Watch-along](https://www.youtube.com/watch?v=KVSrdAbBrpw), reached 3,899 views. The full table and data notes are in the [README](README.md#previous-work--real-world-usage).

## Team
Yash Kavaiya
