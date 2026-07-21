import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { format, resolveConfig } from 'prettier'

import { parseModuleName } from '@scripts/module-generator/module-name'
import {
  readModuleTemplateManifest,
  renderModuleFiles,
} from '@scripts/module-generator/module-template'

async function copyTemplate(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'module-template-'))
  temporaryRoots.push(root)
  const target = join(root, 'template')
  await cp(join(process.cwd(), 'templates/module'), target, {
    recursive: true,
  })
  return target
}

const temporaryRoots: string[] = []

describe('external module template', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots
        .splice(0)
        .map((root) => rm(root, { force: true, recursive: true })),
    )
  })

  it('loads the checked version-one manifest', async () => {
    const templateRoot = await copyTemplate()

    const manifest = await readModuleTemplateManifest(templateRoot)

    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.files).toHaveLength(9)
  })

  it('rejects a manifest schema version drift', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    await writeFile(
      join(templateRoot, 'module.template.json'),
      JSON.stringify({ ...manifest, schemaVersion: 2 }),
      'utf8',
    )

    await expect(readModuleTemplateManifest(templateRoot)).rejects.toThrow(
      'Invalid module template manifest',
    )
  })

  it('rejects coordinated manifest and schema version drift', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    const schemaPath = join(templateRoot, 'module-template.schema.json')
    const schemaSource = await readFile(schemaPath, 'utf8')
    const driftedSchema = schemaSource.replace('"const": 1', '"const": 2')
    expect(driftedSchema).not.toBe(schemaSource)
    await writeFile(schemaPath, driftedSchema, 'utf8')
    await writeFile(
      join(templateRoot, 'module.template.json'),
      JSON.stringify({ ...manifest, schemaVersion: 2 }),
      'utf8',
    )

    await expect(readModuleTemplateManifest(templateRoot)).rejects.toThrow(
      'Unsupported module template schema bytes',
    )
  })

  it('rejects a template path that escapes its root', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    await writeFile(
      join(templateRoot, 'module.template.json'),
      JSON.stringify({
        ...manifest,
        files: [
          {
            target: 'src/modules/{{kebabCase}}/index.ts',
            template: '../outside.tpl',
          },
        ],
      }),
      'utf8',
    )

    await expect(readModuleTemplateManifest(templateRoot)).rejects.toThrow(
      'Template path escapes template root',
    )
  })

  it('rejects a rendered target outside the generated module trees', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    const firstFile = manifest.files[0]
    if (firstFile === undefined) {
      throw new Error('Checked template unexpectedly has no files')
    }
    await writeFile(
      join(templateRoot, 'module.template.json'),
      JSON.stringify({
        ...manifest,
        files: [{ ...firstFile, target: 'README.md' }],
      }),
      'utf8',
    )

    await expect(
      renderModuleFiles(templateRoot, parseModuleName('order-management')),
    ).rejects.toThrow('outside the generated module trees')
  })

  it('rejects an unknown rendering token', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    const firstFile = manifest.files[0]
    if (firstFile === undefined) {
      throw new Error('Checked template unexpectedly has no files')
    }
    await writeFile(
      join(templateRoot, firstFile.template),
      '{{unknownToken}}\n',
      'utf8',
    )

    await expect(
      renderModuleFiles(templateRoot, parseModuleName('order-management')),
    ).rejects.toThrow('Unknown module template token: unknownToken')
  })

  it('rejects an inherited object-property rendering token', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    const firstFile = manifest.files[0]
    if (firstFile === undefined) {
      throw new Error('Checked template unexpectedly has no files')
    }
    await writeFile(
      join(templateRoot, firstFile.template),
      '{{constructor}}\n',
      'utf8',
    )

    await expect(
      renderModuleFiles(templateRoot, parseModuleName('order-management')),
    ).rejects.toThrow('Unknown module template token: constructor')
  })

  it('rejects a non-normalized target path', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    const firstFile = manifest.files[0]
    if (firstFile === undefined) {
      throw new Error('Checked template unexpectedly has no files')
    }
    await writeFile(
      join(templateRoot, 'module.template.json'),
      JSON.stringify({
        ...manifest,
        files: [
          {
            ...firstFile,
            target: 'src/modules/{{kebabCase}}/./application/README.md',
          },
        ],
      }),
      'utf8',
    )

    await expect(readModuleTemplateManifest(templateRoot)).rejects.toThrow(
      'Module template path is not normalized',
    )
  })

  it('rejects distinct manifest targets that render to one path', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    const firstFile = manifest.files[0]
    const secondFile = manifest.files[1]
    if (firstFile === undefined || secondFile === undefined) {
      throw new Error('Checked template unexpectedly has fewer than two files')
    }
    await writeFile(
      join(templateRoot, 'module.template.json'),
      JSON.stringify({
        ...manifest,
        files: [
          {
            ...firstFile,
            target: 'src/modules/{{kebabCase}}/application/index.ts',
          },
          {
            ...secondFile,
            target: 'src/modules/order-management/application/index.ts',
          },
        ],
      }),
      'utf8',
    )

    await expect(
      renderModuleFiles(templateRoot, parseModuleName('order-management')),
    ).rejects.toThrow('Duplicate rendered module target')
  })

  it('rejects a template symlink whose canonical target is outside the template root', async () => {
    const templateRoot = await copyTemplate()
    const manifest = await readModuleTemplateManifest(templateRoot)
    const firstFile = manifest.files[0]
    if (firstFile === undefined) {
      throw new Error('Checked template unexpectedly has no files')
    }
    const templatePath = join(templateRoot, firstFile.template)
    const outsidePath = join(dirname(templateRoot), 'outside.tpl')
    await writeFile(outsidePath, 'outside bytes\n', 'utf8')
    await rm(templatePath)
    await symlink(outsidePath, templatePath)

    await expect(readModuleTemplateManifest(templateRoot)).rejects.toThrow(
      'Template path escapes canonical template root',
    )
  })

  it('renders every generated file in repository format', async () => {
    const templateRoot = await copyTemplate()
    const files = await renderModuleFiles(
      templateRoot,
      parseModuleName('order-management'),
    )
    const prettierConfig =
      (await resolveConfig(join(process.cwd(), 'package.json'))) ?? {}

    for (const file of files) {
      await expect(
        format(file.content, {
          ...prettierConfig,
          filepath: file.target,
        }),
      ).resolves.toBe(file.content)
    }
  })
})
