import { describe, expect, it } from 'vitest'

import { createEditableContractParam } from './contract-params'
import { buildLocalRequestPaths } from './autocomplete-local-context'

describe('local autocomplete request paths', () => {
  it('includes path params, query params, and header params from local state', () => {
    const header = createEditableContractParam('HEADER')
    header.key = 'x-tenant-id'
    const query = createEditableContractParam('QUERY')
    query.key = 'page'

    const paths = buildLocalRequestPaths({
      endpointPath: '/accounts/:accountId/orders/{orderId}',
      editableParams: [header, query],
      requestFieldTypeMap: {},
    })

    expect(paths).toEqual(
      expect.arrayContaining([
        'request.params.path.accountid',
        'request.params.path.orderid',
        'request.params.headers.x-tenant-id',
        'request.params.query.page',
      ])
    )
  })

  it('includes body/query/header keys from unsaved contract field type map', () => {
    const paths = buildLocalRequestPaths({
      endpointPath: '/users/:id',
      editableParams: [],
      requestFieldTypeMap: {
        'request.params.body.email': 'string',
        'request.params.query.search': 'string',
        'request.header.authorization': 'string',
      },
    })

    expect(paths).toEqual(
      expect.arrayContaining([
        'request.params.body.email',
        'request.params.query.search',
        'request.params.headers.authorization',
      ])
    )
  })

  it('does not retain removed params when local state no longer contains them', () => {
    const header = createEditableContractParam('HEADER')
    header.key = 'x-debug'

    const withHeader = buildLocalRequestPaths({
      endpointPath: '/v1/users',
      editableParams: [header],
      requestFieldTypeMap: {},
    })
    const withoutHeader = buildLocalRequestPaths({
      endpointPath: '/v1/users',
      editableParams: [],
      requestFieldTypeMap: {},
    })

    expect(withHeader).toContain('request.params.headers.x-debug')
    expect(withoutHeader).not.toContain('request.params.headers.x-debug')
  })
})
