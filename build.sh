#!/bin/bash

echo "Building Chrome extensions..."

# Create dist directories
mkdir -p dist/exponential
mkdir -p dist/tradescape

# Copy shared files to both extensions
echo "Copying shared files..."
cp -r shared/* exponential/
cp -r shared/* tradescape/

# Copy Exponential extension to dist
echo "Building Exponential extension..."
rsync -av --exclude='.DS_Store' exponential/ dist/exponential/

# Copy Tradescape extension to dist
echo "Building Tradescape extension..."
rsync -av --exclude='.DS_Store' tradescape/ dist/tradescape/

# Clean up copied shared files from source directories
rm -f exponential/shutter.mp3 exponential/timeout.mp3
rm -f tradescape/shutter.mp3 tradescape/timeout.mp3

echo "Build complete! Extensions are in the dist/ folder:"
echo "  - dist/exponential/"
echo "  - dist/tradescape/"