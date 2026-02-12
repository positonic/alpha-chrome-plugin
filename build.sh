#!/bin/bash

echo "Building Chrome extensions..."

# Create dist directories for test and prod versions
mkdir -p dist/exponential-test
mkdir -p dist/exponential-prod
mkdir -p dist/tradescape-test
mkdir -p dist/tradescape-prod

# Copy shared files to both source extensions
echo "Copying shared files..."
cp -r shared/* exponential/
cp -r shared/* tradescape/

# Build Exponential TEST
echo "Building Exponential TEST..."
rsync -av --exclude='.DS_Store' exponential/ dist/exponential-test/
cat > dist/exponential-test/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Alpha Whisper",
    apiBaseURL: "http://localhost:3000",
    hasProjects: true,
    projects: [] // Will be loaded dynamically from API
};
EOF
# Update manifest with test tooltip and name
sed -i '' 's/"default_popup": "popup.html"/"default_popup": "popup.html",\n      "default_title": "Alpha Whisper (TEST - localhost)"/' dist/exponential-test/manifest.json
sed -i '' 's/"name": "Alpha Whisper"/"name": "Alpha Whisper (TEST)"/' dist/exponential-test/manifest.json

# Build Exponential PROD
echo "Building Exponential PROD..."
rsync -av --exclude='.DS_Store' exponential/ dist/exponential-prod/
cat > dist/exponential-prod/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Alpha Whisper",
    apiBaseURL: "https://exponential.im",
    hasProjects: true,
    projects: [] // Will be loaded dynamically from API
};
EOF
# Update manifest with prod tooltip and name
sed -i '' 's/"default_popup": "popup.html"/"default_popup": "popup.html",\n      "default_title": "Alpha Whisper (PROD - exponential.im)"/' dist/exponential-prod/manifest.json
sed -i '' 's/"name": "Alpha Whisper"/"name": "Alpha Whisper (PROD)"/' dist/exponential-prod/manifest.json

# Build Tradescape TEST
echo "Building Tradescape TEST..."
rsync -av --exclude='.DS_Store' tradescape/ dist/tradescape-test/
cat > dist/tradescape-test/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Tradescape",
    apiBaseURL: "http://localhost:3000",
    hasProjects: false,
    projects: [] // No projects for Tradescape
};
EOF
# Update manifest with test tooltip and name
sed -i '' 's/"default_popup": "popup.html"/"default_popup": "popup.html",\n      "default_title": "Tradescape (TEST - localhost)"/' dist/tradescape-test/manifest.json
sed -i '' 's/"name": "Tradescape"/"name": "Tradescape (TEST)"/' dist/tradescape-test/manifest.json

# Build Tradescape PROD
echo "Building Tradescape PROD..."
rsync -av --exclude='.DS_Store' tradescape/ dist/tradescape-prod/
cat > dist/tradescape-prod/config.js << 'EOF'
const EXTENSION_CONFIG = {
    name: "Tradescape",
    apiBaseURL: "https://tradetronic.vercel.app",
    hasProjects: false,
    projects: [] // No projects for Tradescape
};
EOF
# Update manifest with prod tooltip and name
sed -i '' 's/"default_popup": "popup.html"/"default_popup": "popup.html",\n      "default_title": "Tradescape (PROD - tradetronic)"/' dist/tradescape-prod/manifest.json
sed -i '' 's/"name": "Tradescape"/"name": "Tradescape (PROD)"/' dist/tradescape-prod/manifest.json

# Clean up copied shared files from source directories
rm -f exponential/shutter.mp3 exponential/timeout.mp3
rm -f tradescape/shutter.mp3 tradescape/timeout.mp3

echo "Build complete! Extensions are in the dist/ folder:"
echo "  - dist/exponential-test/  (localhost:3000)"
echo "  - dist/exponential-prod/  (exponential.im)"
echo "  - dist/tradescape-test/   (localhost:3000)"
echo "  - dist/tradescape-prod/   (tradetronic.vercel.app)"
