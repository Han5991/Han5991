#!/bin/bash

# Local build script for GitHub profile automation

echo "🔨 Building GitHub Profile automation..."

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build the bundle
echo "🏗️  Building bundle..."
npm run build

# Make the script executable
chmod +x dist/fetch-contributions.js

echo "✅ Build complete!"
echo "📁 Bundle created at: dist/fetch-contributions.js"
echo "🚀 Ready to commit and push!"