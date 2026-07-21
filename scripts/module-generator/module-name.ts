const moduleNamePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const maximumModuleNameLength = 64
const reservedNames = new Set([
  'aux',
  'bootstrap',
  'con',
  'nul',
  'platform',
  'prn',
  'shared',
  ...Array.from({ length: 9 }, (_value, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_value, index) => `lpt${index + 1}`),
])

/**
 * Contains canonical filesystem and TypeScript forms of a module name.
 */
export interface ParsedModuleName {
  readonly kebabCase: string
  readonly pascalCase: string
}

/**
 * Validates and converts one user-provided module name.
 *
 * @param input - Exact normalized kebab-case module name.
 * @returns Canonical kebab-case and PascalCase forms.
 * @throws Error for unsafe, non-normalized or platform-reserved names.
 */
export function parseModuleName(input: string): ParsedModuleName {
  if (
    input.length > maximumModuleNameLength ||
    !moduleNamePattern.test(input) ||
    reservedNames.has(input)
  ) {
    throw new Error(
      `Invalid module name "${input}". Use normalized kebab-case and avoid reserved platform names.`,
    )
  }

  return {
    kebabCase: input,
    pascalCase: input
      .split('-')
      .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
      .join(''),
  }
}
