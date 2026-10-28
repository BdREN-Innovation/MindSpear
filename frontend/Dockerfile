# Production image for the Next.js app, in two stages:
#   build  installs the dependencies and runs `next build`
#   run    serves that build with Next's self-contained server (no dev dependencies, no source)
# Used by docker-compose.prod.yml. Local development uses Dockerfile.dev (`next dev`).
#
# NEXT_PUBLIC_* values are compiled into the browser bundle, so they are build arguments: change
# one and the image has to be rebuilt.

# --- build ---
FROM node:20-slim AS build

# canvas (an optional dependency of pdf.js) may compile from source during the install.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
# `npm install`, not `npm ci`: package-lock.json is out of sync with package.json, which
# `npm ci` refuses. Once the lock is regenerated and committed, switch to `npm ci`.
RUN npm install --no-audit --no-fund

COPY . .

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_REVERB_APP_KEY
ARG NEXT_PUBLIC_REVERB_HOST
ARG NEXT_PUBLIC_REVERB_PORT=443
ARG NEXT_PUBLIC_REVERB_SCHEME=https
ARG NEXT_PUBLIC_PWA_DISABLED=false
ARG NEXT_PUBLIC_AI_API_URL=/ai-api

ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_REVERB_APP_KEY=$NEXT_PUBLIC_REVERB_APP_KEY \
    NEXT_PUBLIC_REVERB_HOST=$NEXT_PUBLIC_REVERB_HOST \
    NEXT_PUBLIC_REVERB_PORT=$NEXT_PUBLIC_REVERB_PORT \
    NEXT_PUBLIC_REVERB_SCHEME=$NEXT_PUBLIC_REVERB_SCHEME \
    NEXT_PUBLIC_PWA_DISABLED=$NEXT_PUBLIC_PWA_DISABLED \
    NEXT_PUBLIC_AI_API_URL=$NEXT_PUBLIC_AI_API_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- run ---
FROM node:20-slim AS run

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Only the traced server files, the static assets and public/.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node

EXPOSE 3000

CMD ["node", "server.js"]
