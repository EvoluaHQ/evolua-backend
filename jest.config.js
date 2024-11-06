module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.js"],
  testTimeout: 300000, // 5 mins (default is 5 seconds)
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "^.+\\.jsx?$": "babel-jest", // if you are using Babel
  },
  transformIgnorePatterns: [],
}
