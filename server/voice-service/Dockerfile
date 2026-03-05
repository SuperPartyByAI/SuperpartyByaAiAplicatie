# Use a Node.js LTS base image
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Expose the port Nginx will proxy to
EXPOSE 3001

# Start the application
CMD [ "npm", "start" ]
