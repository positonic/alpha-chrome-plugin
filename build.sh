#!/bin/bash

echo "Building Chrome extensions..."

# Create dist directory
mkdir -p dist

# Copy shared files to both extensions
echo "Copying shared files..."
cp -r shared/* exponential/
cp -r shared/* tradescape/

# Build Exponential extension
echo "Building Exponential extension..."
cd exponential
zip -r ../dist/exponential.zip . -x "*.DS_Store"
cd ..

# Build Tradescape extension
echo "Building Tradescape extension..."
cd tradescape
zip -r ../dist/tradescape.zip . -x "*.DS_Store"
cd ..

# Clean up copied shared files
rm -f exponential/shutter.mp3 exponential/timeout.mp3
rm -f tradescape/shutter.mp3 tradescape/timeout.mp3

echo "Build complete! Extensions are in the dist/ folder:"
echo "  - dist/exponential.zip"
echo "  - dist/tradescape.zip"