FROM node:20-alpine

WORKDIR /backend

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# 🔥 IMPORTANT: compile NestJS TypeScript
RUN npm run build

# Expose backend port
EXPOSE 4000

# Run compiled app
CMD ["node", "dist/main.js"]

