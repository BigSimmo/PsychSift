#!/bin/bash
# Docker multi-platform build script
# Usage: NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
#          ./scripts/build-multiplatform.sh [app|worker|all]
#   (Both are required for app/all builds; the Dockerfile has no default for either.)
# Requires: docker buildx with multiplatform support enabled

set -e

PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
REGISTRY="${REGISTRY:-ghcr.io}"
# Extract GitHub owner (e.g., "BigSimmo") from git remote URL, fallback to "BigSimmo"
# Default after capture: with no origin, sed still exits 0 on empty input, so `|| echo` never fires.
DETECTED_OWNER="$(git remote get-url origin 2>/dev/null | sed -E 's|.*[:/]([^/]+)/[^/]+(\.git)?$|\1|')"
DETECTED_OWNER="${DETECTED_OWNER:-BigSimmo}"
REPO_OWNER="${REPO_OWNER:-$DETECTED_OWNER}"
TARGET="${1:-all}"
PUSH="${PUSH:-false}"  # Set PUSH=true to push to registry
BUILD_TAG="${BUILD_TAG:-$(git rev-parse --short HEAD)}"

# Multi-platform builds cannot be exported with --load directly to local docker daemon
OUTPUT_FLAG=""
if [ "$PUSH" = "true" ]; then
    OUTPUT_FLAG="--push"
elif [[ "$PLATFORMS" != *","* ]]; then
    OUTPUT_FLAG="--load"
fi

echo "🐳 Docker Multi-Platform Build"
echo "  Platforms: $PLATFORMS"
echo "  Registry: $REGISTRY"
echo "  Repo Owner: $REPO_OWNER"
echo "  Target: $TARGET"
echo "  Push: $PUSH"
echo "  Tag: $BUILD_TAG"
echo ""

# Ensure buildx is available
if ! docker buildx version &>/dev/null; then
    echo "❌ docker buildx not found. Install Docker with buildx support."
    exit 1
fi

# Build app tier
build_app() {
    echo "🏗️  Building app tier (PsychSift)..."
    docker buildx build \
        --platform "$PLATFORMS" \
        --file Dockerfile \
        --cache-from "type=registry,ref=$REGISTRY/$REPO_OWNER/psychsift-app:buildcache" \
        --cache-to "type=registry,ref=$REGISTRY/$REPO_OWNER/psychsift-app:buildcache,mode=max" \
        --tag "$REGISTRY/$REPO_OWNER/psychsift-app:$BUILD_TAG" \
        --tag "$REGISTRY/$REPO_OWNER/psychsift-app:latest" \
        --build-arg "ALLOW_LOW_RAM_BUILD=1" \
        --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL must be set for the app image build}" \
        --build-arg "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set for the app image build}" \
        $OUTPUT_FLAG \
        .
    echo "✅ App tier build complete"
}

# Build worker tier
build_worker() {
    echo "🏗️  Building worker tier..."
    docker buildx build \
        --platform "$PLATFORMS" \
        --file Dockerfile.worker \
        --cache-from "type=registry,ref=$REGISTRY/$REPO_OWNER/psychsift-worker:buildcache" \
        --cache-to "type=registry,ref=$REGISTRY/$REPO_OWNER/psychsift-worker:buildcache,mode=max" \
        --tag "$REGISTRY/$REPO_OWNER/psychsift-worker:$BUILD_TAG" \
        --tag "$REGISTRY/$REPO_OWNER/psychsift-worker:latest" \
        --build-arg "ALLOW_LOW_RAM_BUILD=1" \
        $OUTPUT_FLAG \
        .
    echo "✅ Worker tier build complete"
}

case "$TARGET" in
    app)
        build_app
        ;;
    worker)
        build_worker
        ;;
    all)
        build_app
        build_worker
        ;;
    *)
        echo "❌ Unknown target: $TARGET"
        echo "Usage: $0 [app|worker|all]"
        exit 1
        ;;
esac

echo ""
echo "🎉 Build complete!"
echo "Images tagged: $BUILD_TAG"
if [ "$PUSH" = "true" ]; then
    echo "📤 Pushed to $REGISTRY/$REPO_OWNER"
else
    echo "💾 Loaded locally (use PUSH=true to push to registry)"
fi
