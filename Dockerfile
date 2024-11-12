# Use the official Node.js 18 image with Alpine for a lightweight build
FROM node:18

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
COPY package.json package-lock.json ./

COPY . .

RUN npm install 
# Install dependencies (this will include Babel)
RUN npm install --force
RUN npm install @babel/core @babel/cli @babel/node @babel/preset-env --save-dev


# Copy the rest of the application files into the container


# Expose the application's port
EXPOSE 8080

# Build the application if needed (optional, remove if not using build step)
RUN npm run build

# Start the application using npx babel-node
CMD ["npx", "nodemon", "src/index.js"]