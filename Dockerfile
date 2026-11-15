FROM node:22-alpine

WORKDIR /satyalok-pg-backend

COPY package*.json ./
# Production dependencies only: the test toolchain (mongodb-memory-server)
# downloads a ~140MB mongod binary at install time and must not ship.
RUN npm ci --omit=dev

COPY . .

EXPOSE 5002
CMD ["npm", "start"]