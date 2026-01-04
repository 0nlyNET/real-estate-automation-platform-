FROM node:20-alpine

WORKDIR /backend

# Copy package files
COPY package*.json ./

# Copy tsconfig BEFORE install so nest build works
COPY tsconfig*.json ./

# Install deps (this triggers postinstall -> build)
RUN npm install

# Copy the rest of the backend
COPY . .

# Build explicitly (safe even if postinstall ran)
RUN npm run build

EXPOSE 4000

CMD ["npm", "start"]