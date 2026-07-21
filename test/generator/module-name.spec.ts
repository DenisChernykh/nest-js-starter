import { parseModuleName } from '@scripts/module-generator/module-name'

describe('module name parser', () => {
  it('converts normalized kebab-case to PascalCase', () => {
    expect(parseModuleName('order-management')).toEqual({
      kebabCase: 'order-management',
      pascalCase: 'OrderManagement',
    })
  })

  it.each([
    '',
    'OrderManagement',
    'order_management',
    '../orders',
    'orders/',
    'bootstrap',
    'platform',
    'shared',
    'con',
    'prn',
    'aux',
    'nul',
    ...Array.from({ length: 9 }, (_value, index) => `com${index + 1}`),
    ...Array.from({ length: 9 }, (_value, index) => `lpt${index + 1}`),
    'a'.repeat(65),
  ])('rejects unsafe or reserved name %p', (name) => {
    expect(() => parseModuleName(name)).toThrow('Invalid module name')
  })
})
