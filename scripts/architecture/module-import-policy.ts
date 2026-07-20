import { readFile, readdir } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

/**
 * Describes a forbidden import across a module ownership boundary.
 */
export interface ModuleImportViolation {
  readonly file: string
  readonly reason:
    | 'bootstrap-import-outside-composition'
    | 'cross-module-internal-import'
    | 'domain-imports-other-module'
    | 'module-public-api-exports-non-application'
    | 'platform-or-shared-imports-module'
    | 'relative-cross-module-import'
  readonly specifier: string
}

async function listTypeScriptFiles(
  directory: string,
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        return listTypeScriptFiles(path)
      }
      return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
    }),
  )
  return nested.flat().sort()
}

function collectSpecifiers(
  sourceText: string,
  fileName: string,
): readonly string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  )
  const specifiers: string[] = []

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require')) &&
      node.arguments.length > 0
    ) {
      const argument = node.arguments[0]
      if (argument !== undefined && ts.isStringLiteralLike(argument)) {
        specifiers.push(argument.text)
      }
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression !== undefined &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text)
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function normalizedRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join('/')
}

function moduleFromPath(root: string, path: string): string | undefined {
  return /^modules\/([^/]+)(?:\/|$)/.exec(normalizedRelative(root, path))?.[1]
}

/**
 * Finds imports that bypass module ownership and public entrypoints.
 *
 * @param sourceRoot - Root containing `modules`, `bootstrap`, `platform` and `shared`.
 * @returns Stable file-sorted violations.
 */
export async function findModuleImportViolations(
  sourceRoot: string,
): Promise<readonly ModuleImportViolation[]> {
  const files = await listTypeScriptFiles(sourceRoot)
  const violations: ModuleImportViolation[] = []

  for (const file of files) {
    const fileRelative = normalizedRelative(sourceRoot, file)
    const fromModule = moduleFromPath(sourceRoot, file)
    const publicIndexModule = /^modules\/([^/]+)\/index\.ts$/.exec(
      fileRelative,
    )?.[1]
    const sourceText = await readFile(file, 'utf8')

    for (const specifier of collectSpecifiers(sourceText, file)) {
      if (publicIndexModule !== undefined) {
        const allowedSpecifiers = new Set([
          './application',
          `@/modules/${publicIndexModule}/application`,
        ])
        if (!allowedSpecifiers.has(specifier)) {
          violations.push({
            file: fileRelative,
            reason: 'module-public-api-exports-non-application',
            specifier,
          })
        }
        continue
      }

      const aliasMatch = /^@\/modules\/([^/]+)(.*)$/.exec(specifier)
      const aliasSuffix = aliasMatch?.[2]
      const relativeTarget = specifier.startsWith('.')
        ? resolve(dirname(file), specifier)
        : undefined
      const relativeTargetModule =
        relativeTarget === undefined
          ? undefined
          : moduleFromPath(sourceRoot, relativeTarget)
      const targetModule = aliasMatch?.[1] ?? relativeTargetModule

      if (targetModule === undefined) {
        continue
      }

      if (
        fileRelative.startsWith('platform/') ||
        fileRelative.startsWith('shared/')
      ) {
        violations.push({
          file: fileRelative,
          reason: 'platform-or-shared-imports-module',
          specifier,
        })
        continue
      }

      if (fileRelative.startsWith('bootstrap/')) {
        const isCompositionImport =
          aliasSuffix?.startsWith('/composition/') === true &&
          aliasSuffix.endsWith('.module')
        if (!isCompositionImport) {
          violations.push({
            file: fileRelative,
            reason: 'bootstrap-import-outside-composition',
            specifier,
          })
        }
        continue
      }

      if (fromModule === undefined || targetModule === fromModule) {
        continue
      }

      if (fileRelative.startsWith(`modules/${fromModule}/domain/`)) {
        violations.push({
          file: fileRelative,
          reason: 'domain-imports-other-module',
          specifier,
        })
        continue
      }

      if (relativeTargetModule !== undefined) {
        violations.push({
          file: fileRelative,
          reason: 'relative-cross-module-import',
          specifier,
        })
        continue
      }

      if (aliasSuffix !== '') {
        violations.push({
          file: fileRelative,
          reason: 'cross-module-internal-import',
          specifier,
        })
      }
    }
  }

  return violations.sort((left, right) =>
    `${left.file}:${left.specifier}`.localeCompare(
      `${right.file}:${right.specifier}`,
    ),
  )
}
