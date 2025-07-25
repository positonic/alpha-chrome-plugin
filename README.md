# Chrome Extensions Setup

This repository contains two Chrome extensions:

1. **Exponential** (Alpha Whisper) - Voice dictation with project management
2. **Tradescape** - Simplified voice dictation without project management

## Structure

```
├── exponential/        # Exponential extension
│   ├── config.js      # Extension configuration
│   ├── manifest.json  # Chrome manifest
│   ├── popup.html/js  # Extension popup
│   ├── dictation.*    # Dictation window
│   └── icons/         # Extension icons
│
├── tradescape/        # Tradescape extension  
│   ├── config.js      # Extension configuration
│   ├── manifest.json  # Chrome manifest
│   ├── popup.html/js  # Simplified popup (no projects)
│   ├── dictation.*    # Dictation window
│   └── icons/         # Extension icons (need to be added)
│
├── shared/            # Shared resources
│   ├── shutter.mp3   # Screenshot sound
│   └── timeout.mp3   # Timeout sound
│
└── build.sh          # Build script
```

## Configuration

### Exponential
- API URL: `https://thehaven-hq.vercel.app`
- Has project dropdown with 4 projects
- Sends projectId with API requests

### Tradescape
- API URL: `https://thehaven-hq.vercel.app`
- No project selection
- No projectId in API requests

## Building

Run the build script to create zip files for both extensions:

```bash
./build.sh
```

This will create:
- `dist/exponential.zip`
- `dist/tradescape.zip`

## Important Notes

1. **Tradescape API URL**: Update `tradescape/config.js` with the correct API URL
2. **Tradescape Icons**: Add icon files to `tradescape/icons/`:
   - tradescape-16.png
   - tradescape-32.png
   - tradescape-48.png
   - tradescape-128.png

## Loading in Chrome

1. Open Chrome Extensions page (chrome://extensions/)
2. Enable Developer mode
3. Click "Load unpacked"
4. Select either `exponential/` or `tradescape/` folder