module.exports = {
    parser: '@typescript-eslint/parser', // Specifies the ESLint parser
    parserOptions: {
      ecmaVersion: 2020, // Allows for the parsing of modern ECMAScript features
      sourceType: 'module', // Allows for the use of imports
      project: './tsconfig.json', // Tells ESLint to use your project's TypeScript configuration
    },
    plugins: ['@typescript-eslint'], // Defines the ESLint plugin(s) to use
    extends: [
      'eslint:recommended', // Uses the recommended ESLint rules
      'plugin:@typescript-eslint/recommended', // Uses the recommended rules from the @typescript-eslint plugin
    ],
    rules: {
      // Add custom rules here
    },
  };