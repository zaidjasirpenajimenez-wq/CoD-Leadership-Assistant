FROM node:20-slim

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.26.1 --activate

WORKDIR /app

# Copy workspace config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY tsconfig.base.json tsconfig.json ./

# Copy lib packages
COPY lib/ ./lib/

# Copy the api-server artifact
COPY artifacts/api-server/ ./artifacts/api-server/

# Install all dependencies (including devDeps needed for build)
RUN pnpm install --frozen-lockfile

# Approve build scripts (required for tesseract.js)
RUN pnpm approve-builds --all 2>/dev/null || true

# Build the api-server bundle
RUN pnpm --filter @workspace/api-server run build

# Remove dev dependencies to slim the image
RUN pnpm prune --prod 2>/dev/null || true

# Expose the port the app listens on (Railway/Koyeb inject PORT automatically)
EXPOSE 8080

# Run the compiled bundle
CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
