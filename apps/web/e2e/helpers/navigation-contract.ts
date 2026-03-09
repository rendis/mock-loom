import fs from 'node:fs'

import { expect } from '@playwright/test'

const forbiddenDirectGotoPatterns = [
  /page\.goto\(\s*['"`]\/workspace\b/,
  /page\.goto\(\s*['"`]\/integrations\//,
]

export function assertNoDirectPrivateRouteGoto(specFilePath: string): void {
  const source = fs.readFileSync(specFilePath, 'utf8')
  for (const pattern of forbiddenDirectGotoPatterns) {
    expect(source).not.toMatch(pattern)
  }
}
