module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.js"],
  testTimeout: 40000, // 40 seconds (default is 5 seconds)
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "^.+\\.jsx?$": "babel-jest", // if you are using Babel
  },
  transformIgnorePatterns: [],
}
