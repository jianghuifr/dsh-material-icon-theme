/**
 * Client bundle contract for the icon package: loader registration, plugin
 * exports, locale/slot registrations, the extraIcons switch, legacy-store
 * migration and runtime disposal.
 *
 * `lib/client.js` is a hand-written classic script, so the test runs it in a vm
 * context with small DOM/storage stubs rather than a browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const clientSource = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const LEGACY_KEY = 'dsh-material-icon-theme:features'
const STORAGE_KEY = '@jianghuifr/dsh-material-icon-theme-icon:features'

function createStorage(entries = {}) {
  const map = new Map(Object.entries(entries).map(([key, value]) => [key, String(value)]))
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    },
    dump() {
      return Object.fromEntries(map)
    },
  }
}

function createDom() {
  const styles = []
  const observers = []
  const frames = []
  const attributes = new WeakMap()

  function attrsOf(element) {
    let map = attributes.get(element)
    if (map === undefined) {
      map = new Map()
      attributes.set(element, map)
    }
    return map
  }

  function createElement(tagName) {
    const element = {
      tagName: String(tagName).toUpperCase(),
      nodeType: 1,
      isConnected: true,
      children: [],
      style: {},
      textContent: '',
      setAttribute(name, value) {
        attrsOf(element).set(String(name), String(value))
      },
      getAttribute(name) {
        return attrsOf(element).has(name) ? attrsOf(element).get(name) : null
      },
      hasAttribute(name) {
        return attrsOf(element).has(name)
      },
      removeAttribute(name) {
        attrsOf(element).delete(name)
      },
      appendChild(child) {
        element.children.push(child)
        if (child.tagName === 'STYLE') styles.push(child)
        return child
      },
      remove() {
        element.isConnected = false
        const index = styles.indexOf(element)
        if (index !== -1) styles.splice(index, 1)
      },
      querySelector() {
        return null
      },
      querySelectorAll() {
        return []
      },
    }
    return element
  }

  const head = createElement('head')
  const body = createElement('body')
  const documentElement = createElement('html')
  documentElement.appendChild(head)
  documentElement.appendChild(body)

  function styleNameOf(selector) {
    const match = /data-dsh-mi-style="([^"]+)"/u.exec(selector)
    return match === null ? null : match[1]
  }

  const document = {
    head,
    body,
    documentElement,
    readyState: 'complete',
    createElement,
    querySelector(selector) {
      const name = styleNameOf(selector)
      if (name !== null) return styles.find(style => style.getAttribute('data-dsh-mi-style') === name) ?? null
      return null
    },
    querySelectorAll(selector) {
      const name = styleNameOf(selector)
      if (name !== null) return styles.filter(style => style.getAttribute('data-dsh-mi-style') === name)
      return []
    },
  }

  class MutationObserver {
    constructor(callback) {
      this.callback = callback
      this.disconnected = false
      observers.push(this)
    }

    observe(target, options) {
      this.target = target
      this.options = options
    }

    disconnect() {
      this.disconnected = true
    }
  }

  const window = {
    localStorage: createStorage(),
    Image: class {
      set src(value) {
        this._src = value
      }
    },
    requestAnimationFrame(callback) {
      frames.push(callback)
      return frames.length
    },
    cancelAnimationFrame() {},
    setTimeout() {
      return 0
    },
    clearTimeout() {},
  }

  return { document, window, MutationObserver, styles, observers, frames }
}

function fakeReact() {
  return {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      if (children.length === 1) merged.children = children[0]
      else if (children.length > 1) merged.children = children
      if (typeof type === 'function') return type(merged)
      return { type, props: merged, children }
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
  }
}

function createRequire() {
  return specifier => {
    if (specifier === 'react') return fakeReact()
    throw new Error('unexpected require: ' + specifier)
  }
}

function mountClient({ storage = createStorage() } = {}) {
  const dom = createDom()
  dom.window.localStorage = storage
  let captured = null
  dom.window.__ModuleLoader__ = {
    load(entry) {
      captured = entry
    },
  }
  vm.runInNewContext(clientSource, {
    window: dom.window,
    document: dom.document,
    MutationObserver: dom.MutationObserver,
    console,
  }, { filename: 'lib/client.js' })
  assert.ok(captured !== null, 'client.js must register one module with the loader')
  return { captured, exports: captured.factory(createRequire()), dom, storage }
}

function createContext() {
  const events = { locale: [], slotOwners: [], registrations: [], effects: [] }
  const ctx = {
    effect(callback, label) {
      const disposer = callback()
      events.effects.push({ label, disposer })
      return disposer
    },
    locale: {
      register(namespace, dictionaries) {
        events.locale.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        return key => 't:' + key + '@' + namespace
      },
    },
    slots: {
      inject(owner, callback) {
        events.slotOwners.push(owner)
        return callback()
      },
      register(options, component) {
        events.registrations.push({ options, component })
        return () => {}
      },
    },
  }
  return { ctx, events }
}

function applyPlugin(options) {
  const client = mountClient(options)
  const context = createContext()
  client.exports.apply(context.ctx)
  return { ...client, ...context }
}

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function switches(tree) {
  const found = []
  walk(tree, node => {
    if (node.type === 'button' && node.props.role === 'switch') found.push(node)
  })
  return found
}

function settingsView(events) {
  const entry = events.registrations.find(candidate => candidate.options.name === 'plugins.row.config')
  assert.ok(entry !== undefined, 'missing plugins.row.config registration')
  return entry.component
}

test('client bundle registers the package id and runs no factory side effects', () => {
  const dom = createDom()
  dom.window.__ModuleLoader__ = { load(entry) { dom.window.__captured = entry } }
  vm.runInNewContext(clientSource, {
    window: dom.window,
    document: dom.document,
    MutationObserver: dom.MutationObserver,
    console,
  })
  assert.equal(dom.window.__captured.id, packageJson.name)
  assert.equal(dom.window.__captured.id, '@jianghuifr/dsh-material-icon-theme-icon')
  assert.equal(dom.styles.length, 0)
  assert.equal(dom.observers.length, 0)
})

test('client exports the icon plugin contract and registers its row', () => {
  const { exports, events } = applyPlugin()
  assert.deepEqual(Array.from(exports.inject), ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(events.slotOwners, ['plugins.row.config'])
  const row = events.registrations[0]
  assert.equal(row.options.key, '@jianghuifr/dsh-material-icon-theme-icon#dsh-material-icon-theme-icon')
  assert.equal(row.options.locale, 'dshMaterialIconThemeIcon')
})

test('locale namespace carries English and Chinese dictionaries with every key', () => {
  const { events } = applyPlugin()
  const [{ namespace, dictionaries }] = events.locale
  assert.equal(namespace, 'dshMaterialIconThemeIcon')
  const englishKeys = Object.keys(dictionaries.en).sort()
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), englishKeys)
  for (const key of ['settings.summary', 'settings.extraIcons.label', 'settings.extraIcons.description', 'settings.note.fileTree', 'settings.note.storage']) {
    assert.ok(englishKeys.includes(key), 'missing locale key ' + key)
  }
})

test('settings page renders one switch, on by default', () => {
  const { events } = applyPlugin()
  const SettingsView = settingsView(events)
  const page = SettingsView({ view: 'page', t: key => 't:' + key })
  const found = switches(page)
  assert.equal(found.length, 1)
  assert.equal(found[0].props['aria-checked'], true)
  assert.equal(SettingsView({ view: 'summary', t: key => 't:' + key }), 't:settings.summary')
})

test('toggling the switch persists it and a fresh bundle reads it back', () => {
  const { events, storage } = applyPlugin()
  const SettingsView = settingsView(events)
  switches(SettingsView({ view: 'page', t: key => 't:' + key }))[0].props.onClick()
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).extraIcons, false)
  assert.equal(switches(SettingsView({ view: 'page', t: key => 't:' + key }))[0].props['aria-checked'], false)

  const reloaded = applyPlugin({ storage: createStorage(storage.dump()) })
  assert.equal(switches(settingsView(reloaded.events)({ view: 'page', t: key => 't:' + key }))[0].props['aria-checked'], false)
})

test('the pre-split shared store value is migrated when no own value exists', () => {
  const legacy = createStorage({ [LEGACY_KEY]: JSON.stringify({ extraIcons: false, styleTweaks: true, syntaxExtras: true }) })
  const { events } = applyPlugin({ storage: legacy })
  const page = settingsView(events)({ view: 'page', t: key => 't:' + key })
  assert.equal(switches(page)[0].props['aria-checked'], false)
  // A value in the package's own store wins over the legacy one.
  const own = createStorage({
    [LEGACY_KEY]: JSON.stringify({ extraIcons: false }),
    [STORAGE_KEY]: JSON.stringify({ extraIcons: true }),
  })
  const fresh = applyPlugin({ storage: own })
  assert.equal(switches(settingsView(fresh.events)({ view: 'page', t: key => 't:' + key }))[0].props['aria-checked'], true)
})

test('dispose removes the style sheet and disconnects the observer', () => {
  const { events, dom } = applyPlugin()
  assert.equal(dom.styles.length, 1)
  assert.equal(dom.observers.length, 1)
  const runtime = events.effects.find(entry => entry.label === 'dsh-material-icon-theme-icon: icon runtime')
  assert.ok(runtime !== undefined)
  runtime.disposer()
  assert.equal(dom.observers[0].disconnected, true)
  assert.equal(dom.styles.filter(style => style.getAttribute('data-dsh-mi-style') === 'material-icon-theme:icon').length, 0)
  runtime.disposer()
})
