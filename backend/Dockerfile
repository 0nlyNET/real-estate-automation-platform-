# backend/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install deps first (better caching)
COPY package*.json ./
RUN npm ci

# Copy the rest of the backend
COPY . .

# Build Nest into /dist
RUN npm run build

# Railway sets PORT, Nest should listen on it
ENV NODE_ENV=production
EXPOSE 4000

CMD ["npm", "start"]