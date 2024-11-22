FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
COPY package.json package-lock.json ./

# Install dependencies (this will include Babel and any other dependencies)
RUN npm install --production

# Copy the rest of the application files into the container
COPY . .

# Optionally, install development dependencies if needed (e.g., for testing)
# Uncomment the following line if you need dev dependencies in the container
# RUN npm install --force

# Expose the application's port
EXPOSE 8080

# Build the application if needed (optional, remove if not using build step)
# Uncomment the following line if you have a build step to run
RUN npm run build

# Start the application
CMD ["npx", "nodemon", "src/index.js"]
