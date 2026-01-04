FROM node:20-alpine

WORKDIR /backend

# Copy dependency files first
COPY package*.json ./

# Install deps
RUN npm install

# Copy rest of backend
COPY . .

# Build NestJS
RUN npm run build

EXPOSE 3001

CMD ["node", "dist/main.js"]