#!/bin/bash

BUILD_PROD=false
if [ "$1" = "--prod" ]; then
    BUILD_PROD=true
fi

echo "Building Chrome extensions..."

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Bundle the Whisper worker with transformers.js
echo "Bundling Whisper worker..."
npx esbuild shared/whisper-worker.js \
    --bundle \
    --format=esm \
    --outfile=shared/whisper-worker.bundle.js \
    --platform=browser \
    --target=chrome114

# Copy ONNX Runtime WASM files locally (CSP blocks CDN loading)
echo "Copying ONNX Runtime WASM files..."
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs shared/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm shared/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs shared/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm shared/

# Create dist directories
mkdir -p dist/exponential-test
mkdir -p dist/tradescape-test

# Copy shared files to both source extensions
echo "Copying shared files..."
cp -r shared/* exponential/
cp -r shared/* tradescape/

# Build Exponential TEST
echo "Building Exponential TEST..."
rsync -av --delete --exclude='.DS_Store' exponential/ dist/exponential-test/
cat > dist/exponential-test/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Exponential Whisper",
    apiBaseURL: "http://localhost:3000",
    hasProjects: true,
    projects: [] // Will be loaded dynamically from API
};
EOF
sed -i '' 's/"action": {/"action": {\n      "default_title": "Exponential Whisper (TEST - localhost)",/' dist/exponential-test/manifest.json
sed -i '' 's/"name": "Exponential Whisper"/"name": "Exponential Whisper (TEST)"/' dist/exponential-test/manifest.json

# Build Tradescape TEST
echo "Building Tradescape TEST..."
rsync -av --delete --exclude='.DS_Store' tradescape/ dist/tradescape-test/
cat > dist/tradescape-test/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Tradescape",
    apiBaseURL: "http://localhost:3000",
    hasProjects: false,
    projects: [] // No projects for Tradescape
};
EOF
sed -i '' 's/"action": {/"action": {\n      "default_title": "Tradescape (TEST - localhost)",/' dist/tradescape-test/manifest.json
sed -i '' 's/"name": "Tradescape"/"name": "Tradescape (TEST)"/' dist/tradescape-test/manifest.json

if [ "$BUILD_PROD" = true ]; then
    mkdir -p dist/exponential-prod
    mkdir -p dist/tradescape-prod

    # Build Exponential PROD
    echo "Building Exponential PROD..."
    rsync -av --delete --exclude='.DS_Store' exponential/ dist/exponential-prod/
    cat > dist/exponential-prod/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Exponential Whisper",
    apiBaseURL: "https://www.exponential.im",
    hasProjects: true,
    projects: [] // Will be loaded dynamically from API
};
EOF
    sed -i '' 's/"action": {/"action": {\n      "default_title": "Exponential Whisper (PROD - exponential.im)",/' dist/exponential-prod/manifest.json
    sed -i '' 's/"name": "Exponential Whisper"/"name": "Exponential Whisper (PROD)"/' dist/exponential-prod/manifest.json

    # Build Tradescape PROD
    echo "Building Tradescape PROD..."
    rsync -av --delete --exclude='.DS_Store' tradescape/ dist/tradescape-prod/
    cat > dist/tradescape-prod/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Tradescape",
    apiBaseURL: "https://tradetronic.vercel.app",
    hasProjects: false,
    projects: [] // No projects for Tradescape
};
EOF
    sed -i '' 's/"action": {/"action": {\n      "default_title": "Tradescape (PROD - tradetronic)",/' dist/tradescape-prod/manifest.json
    sed -i '' 's/"name": "Tradescape"/"name": "Tradescape (PROD)"/' dist/tradescape-prod/manifest.json
fi

# Clean up copied shared files from source directories
SHARED_FILES="shutter.mp3 timeout.mp3 audio-processor.js whisper-worker.js whisper-worker.bundle.js speech-engine-google.js speech-engine-whisper.js sidepanel.html sidepanel.js background.js permissions.html permissions.js annotation-overlay.js ort-wasm-simd-threaded.jsep.mjs ort-wasm-simd-threaded.jsep.wasm ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm"
for f in $SHARED_FILES; do
    rm -f "exponential/$f" "tradescape/$f"
done

echo ""
echo "Build complete!"
echo "  - dist/exponential-test/  (localhost:3000)"
echo "  - dist/tradescape-test/   (localhost:3000)"
if [ "$BUILD_PROD" = true ]; then
    echo "  - dist/exponential-prod/  (exponential.im)"
    echo "  - dist/tradescape-prod/   (tradetronic.vercel.app)"
else
    echo ""
    echo "Run with --prod to also build production variants."
fi
