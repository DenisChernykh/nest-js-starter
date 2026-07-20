/** @type {import('jest').Config} */
const config = {
  clearMocks: true,
  moduleFileExtensions: ['js', 'json', 'ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@scripts/(.*)$': '<rootDir>/scripts/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/architecture/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
      },
    ],
  },
}

export default config
