import type { Page } from '@playwright/test'

type DomNode = {
  nodeType: number
  nodeName: string
  nodeValue: string
  attributes?: string[]
  children?: DomNode[]
  shadowRoots?: DomNode[]
}

const HOST_ID = 'rebobinate-speed-host'

const findHost = (node: DomNode): DomNode | null => {
  const attributes = node.attributes ?? []

  for (let index = 0; index < attributes.length; index += 2) {
    if (attributes[index] === 'id' && attributes[index + 1] === HOST_ID) {
      return node
    }
  }

  for (const child of node.children ?? []) {
    const found = findHost(child)

    if (found) {
      return found
    }
  }

  return null
}

const TEXT_NODE = 3

const textOf = (node: DomNode): string =>
  node.nodeType === TEXT_NODE
    ? node.nodeValue
    : (node.children ?? []).map(textOf).join('')

/**
 * What the badge says. Its shadow root is closed, so nothing running in the
 * page can read it, which is the point; the DevTools protocol pierces closed
 * roots, and is what reads it here. The label is the root's only `div`.
 */
export const badgeText = async (page: Page): Promise<string> => {
  const cdp = await page.context().newCDPSession(page)

  try {
    const { root } = (await cdp.send('DOM.getDocument', {
      depth: -1,
      pierce: true,
    })) as { root: DomNode }
    const shadow = findHost(root)?.shadowRoots?.[0]
    const label = shadow?.children?.find(child => child.nodeName === 'DIV')

    return label ? textOf(label) : ''
  } finally {
    await cdp.detach()
  }
}
