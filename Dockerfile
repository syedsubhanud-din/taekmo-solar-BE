# Use the Node.js LTS image
FROM node:20-alpine

# Set the working directory in the container
WORKDIR /app

# Copy only package files first for better caching
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the rest of the source code
COPY . .

# Set environment and expose app port
ENV NODE_ENV=production
EXPOSE 5000

# Run the server with seeding
CMD ["sh", "-c", "node dbSeed.js && node index.js"]
