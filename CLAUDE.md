# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome extension called "Alpha Trader" that provides voice dictation functionality. The extension allows users to speak into their microphone and have their speech transcribed and inserted into text fields on web pages. It also includes screenshot functionality with voice commands.

## Architecture

### Core Components

1. **popup.html/popup.js** - Extension popup interface that handles:
   - API key configuration and storage
   - Launching the dictation window
   - Microphone permission management

2. **dictation.html/dictation.js** - Main dictation window that provides:
   - Continuous speech recognition using Web Speech API
   - Real-time transcription display
   - Session management with remote server
   - Screenshot capture via voice commands ("take screenshot")
   - Audio feedback (shutter sound for screenshots)

3. **manifest.json** - Chrome extension manifest (v3) defining:
   - Required permissions: activeTab, scripting, tabs, storage, windows
   - Host permissions for all URLs
   - Web accessible resources

### Key Features

- **Voice Dictation**: Continuous speech recognition that automatically restarts on timeout
- **Screenshot Integration**: Voice command "take screenshot" captures visible tab and saves locally/remotely
- **Session Management**: Transcriptions are saved to remote server with session tracking
- **API Integration**: Connects to `https://thehaven-hq.vercel.app` for transcription storage
- **Chrome Extension Architecture**: Uses popup for configuration, detached window for dictation

### Data Flow

1. User configures API key in popup
2. Popup launches dictation window
3. Dictation window starts speech recognition session on remote server
4. Speech is continuously recognized and transcribed
5. Transcriptions are automatically saved to server with session ID
6. Screenshot commands trigger capture and upload to server

### Audio Files

- **shutter.mp3** - Played when screenshot is captured
- **timeout.mp3** - Audio feedback for timeouts (referenced but not actively used)

## Development Notes

- No build process required - this is a vanilla JavaScript Chrome extension
- Uses Web Speech API (webkitSpeechRecognition) for speech recognition
- Requires microphone permissions to function
- Extension communicates with external API for transcription storage
- Uses Chrome's tabs and windows APIs for screenshot functionality

## API Configuration

The extension requires an API key stored in Chrome's local storage (`TRANSCRIPTION_API_KEY`) to communicate with the remote transcription service.

## Browser Compatibility

- Chrome/Chromium only (uses webkitSpeechRecognition)
- Requires microphone access
- Uses Chrome Extension Manifest V3

## Workflow — Beads Task Tracking

**All task tracking in this project MUST use beads (`bd`).** Do not use TodoWrite, markdown task lists, or any other tracking method.

### Rules
- **Before writing code**: Create beads issues for the work (`bd create --title="..." --type=task|bug|feature --priority=2`)
- **When starting work**: Mark the issue in progress (`bd update <id> --status=in_progress`)
- **When done**: Close the issue (`bd close <id>`)
- **Plans → Beads**: When planning multi-step work, create a bead for each step. Use `bd dep add` for ordering dependencies.
- **Never use** TodoWrite or markdown files for task tracking

### Session Close Protocol
Before ending a session, always run:
1. `git status` — check what changed
2. `git add <files>` — stage code changes
3. `bd sync` — commit beads changes
4. `git commit -m "..."` — commit code
5. `bd sync` — commit any new beads changes
6. `git push` — push to remote