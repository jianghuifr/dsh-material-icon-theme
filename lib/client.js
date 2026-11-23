/**
 * `@jianghuifr/dsh-material-icon-theme` — Web client half.
 *
 * Paints Material Icon Theme artwork onto existing application icons without
 * touching React's nodes: the app keeps its own <svg>, we only add
 * `background-image` (which React does not manage) plus an invisible
 * `data-dsh-mi` marker that hides the original monochrome glyph.
 *
 * Files tree icons are always on. The `extraIcons` switch adds workspace group
 * headers, the composer workspace chip and document preview tab chips.
 *
 * The host half (lib/index.js) owns the mapping tables and serves one SVG per
 * resolved filename; this file holds no mapping data.
 */
window.__ModuleLoader__.load({
  id: '@jianghuifr/dsh-material-icon-theme',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    // -----------------------------------------------------------------------
    // Identity and constants
    // -----------------------------------------------------------------------

    const ROW_ID = 'dsh-material-icon-theme'
    /** `<package name>#<row id>` — the key the Plugins page dispatches. */
    const ROW_CONFIG_KEY = '@jianghuifr/dsh-material-icon-theme#' + ROW_ID
    const ROUTE = '/material-icon-theme/'
    const LOCALE_NS = 'dshMaterialIconThemeIcon'
    const STORAGE_KEY = '@jianghuifr/dsh-material-icon-theme:features'
    /** Keys tried when this package's own key is absent: the previous package name, then the merged plugin. */
    const LEGACY_STORAGE_KEYS = [
      '@jianghuifr/dsh-material-icon-theme-icon:features',
      'dsh-material-icon-theme:features',
    ]
    const FEATURE_KEYS = ['extraIcons']

    const DEFAULT_FEATURES = Object.freeze({ extraIcons: true })

    // -----------------------------------------------------------------------
    // Feature store (localStorage, shared by the settings page and runtime)
    // -----------------------------------------------------------------------

    let features = null
    const featureListeners = new Set()

    function readOwnFeatures() {
      const next = { ...DEFAULT_FEATURES }
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const key of FEATURE_KEYS) {
              if (typeof parsed[key] === 'boolean') next[key] = parsed[key]
            }
          }
          return next
        }
        for (const legacyKey of LEGACY_STORAGE_KEYS) {
          const legacy = window.localStorage.getItem(legacyKey)
          if (legacy === null) continue
          try {
            const parsed = JSON.parse(legacy)
            if (parsed !== null && typeof parsed === 'object' && typeof parsed.extraIcons === 'boolean') {
              next.extraIcons = parsed.extraIcons
              break
            }
          } catch {
            // Skip a corrupt legacy value and try the next key.
          }
        }
      } catch {
        // A corrupt or blocked store falls back to the defaults.
      }
      return next
    }

    /** Stable snapshot for useSyncExternalStore; lazily initialized on first read. */
    function getFeatures() {
      if (features === null) features = Object.freeze(readOwnFeatures())
      return features
    }

    function subscribeFeatures(listener) {
      featureListeners.add(listener)
      return () => {
        featureListeners.delete(listener)
      }
    }

    function setFeature(key, value) {
      if (!FEATURE_KEYS.includes(key) || typeof value !== 'boolean') return
      const current = getFeatures()
      if (current[key] === value) return
      features = Object.freeze({ ...current, [key]: value })
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(features))
      } catch {
        // Persistence may be blocked; the live value still applies.
      }
      for (const listener of [...featureListeners]) {
        try {
          listener()
        } catch (error) {
          console.error('[dsh-material-icon-theme] feature listener failed', error)
        }
      }
    }

    // -----------------------------------------------------------------------
    // Icon URL construction and probe/paint state
    // -----------------------------------------------------------------------

    const urlCache = new Map()
    const probeCache = new Map()
    const probing = new Set()
    const trackedExtras = new Set()

    function iconUrl(name, isDir, expanded) {
      const cacheKey = name + '\u0000' + (isDir ? '1' : '0') + '\u0000' + (expanded ? '1' : '0')
      let url = urlCache.get(cacheKey)
      if (url === undefined) {
        url = ROUTE + encodeURIComponent(name) + '?d=' + (isDir ? '1' : '0') + '&o=' + (expanded ? '1' : '0')
        urlCache.set(cacheKey, url)
      }
      return url
    }

    function baseName(path) {
      if (typeof path !== 'string' || path === '') return ''
      const normalized = path.replaceAll('\\', '/')
      return normalized.slice(normalized.lastIndexOf('/') + 1)
    }

    function commitIcon(element, key, url) {
      if (element.getAttribute('data-dsh-mi-key') === key && element.hasAttribute('data-dsh-mi')) return
      element.setAttribute('data-dsh-mi', '')
      element.setAttribute('data-dsh-mi-key', key)
      element.style.backgroundImage = 'url("' + url + '")'
    }

    function markUnavailable(element) {
      element.setAttribute('data-dsh-mi-unavailable', '')
    }

    function revertIcon(element) {
      if (element === null || element === undefined || element.nodeType !== 1) return
      element.removeAttribute('data-dsh-mi')
      element.removeAttribute('data-dsh-mi-key')
      element.removeAttribute('data-dsh-mi-unavailable')
      element.style.backgroundImage = ''
    }

    /** Paint one element once its URL is known-good; never replace the app glyph on failure. */
    function paintIcon(element, key, name, isDir, expanded, requestPass) {
      if (element === null || element === undefined || element.nodeType !== 1) return
      if (element.getAttribute('data-dsh-mi-key') === key && element.hasAttribute('data-dsh-mi')) return
      if (element.hasAttribute('data-dsh-mi-unavailable')) return
      const url = iconUrl(name, isDir, expanded)
      const status = probeCache.get(url)
      if (status === 'unavailable') {
        markUnavailable(element)
        return
      }
      if (status === 'ok') {
        commitIcon(element, key, url)
        return
      }
      if (probing.has(url)) return
      probing.add(url)
      const probe = new window.Image()
      probe.onload = () => {
        probing.delete(url)
        probeCache.set(url, 'ok')
        requestPass()
      }
      probe.onerror = () => {
        probing.delete(url)
        probeCache.set(url, 'unavailable')
        requestPass()
      }
      probe.src = url
    }

    // -----------------------------------------------------------------------
    // DOM passes
    // -----------------------------------------------------------------------

    /** A rendered-svg value counts as monochrome when every explicit paint uses currentColor. */
    function isMonochromeSvg(svg) {
      const nodes = [svg, ...svg.querySelectorAll('*')]
      for (const node of nodes) {
        for (const attribute of ['fill', 'stroke']) {
          const raw = node.getAttribute(attribute)
          if (raw === null) continue
          const value = raw.trim()
          if (value === '' || value === 'none' || value === 'currentColor' || value === 'inherit') continue
          if (value.startsWith('var(')) continue
          return false
        }
      }
      return true
    }

    const TAB_CLOSE_SUFFIX = /[\u00d7\u2715\u2716]\s*$/u

    /** Files tree rows: every file and directory row, always painted. */
    function paintTree(requestPass) {
      for (const row of document.querySelectorAll('li[data-files-entry][data-files-path]')) {
        const kind = row.getAttribute('data-files-entry')
        if (kind !== 'file' && kind !== 'directory') continue
        const name = baseName(row.getAttribute('data-files-path'))
        if (name === '') continue
        const icon = row.querySelector('svg')
        if (icon === null) continue
        const isDir = kind === 'directory'
        const expanded = isDir && row.querySelector('button[aria-expanded="true"]') !== null
        paintIcon(icon, 'tree:' + name + '\u0000' + (isDir ? '1' : '0') + '\u0000' + (expanded ? '1' : '0'), name, isDir, expanded, requestPass)
      }
    }

    /** Workspace group header rows use one fixed blue Material project folder. */
    function paintWorkspaceRows(requestPass) {
      for (const row of document.querySelectorAll('[data-row-key^="workspace:"]')) {
        const holder = row.querySelector('[class*="_folder"]')
        const icon = holder === null ? row.querySelector('svg') : holder.querySelector('svg')
        if (icon === null) continue
        const expanded = row.getAttribute('aria-expanded') === 'true'
        trackedExtras.add(icon)
        paintIcon(icon, 'workspace:project:' + (expanded ? '1' : '0'), 'project', true, expanded, requestPass)
      }
    }

    /** The composer workspace chip keeps the fixed closed project folder. */
    function paintComposerChips(requestPass) {
      for (const icon of document.querySelectorAll('[data-composer-seat] svg[data-icon="dsw-icon-folder-open-regular"]')) {
        trackedExtras.add(icon)
        paintIcon(icon, 'composer:project', 'project', true, false, requestPass)
      }
    }

    /** Document preview tab chips: only named files with an extension and a monochrome svg. */
    function paintPreviewTabs(requestPass) {
      for (const chip of document.querySelectorAll('span[data-sidebar-right-tab]')) {
        const title = (chip.textContent === null ? '' : chip.textContent).replace(TAB_CLOSE_SUFFIX, '').trim()
        if (title.indexOf('.') === -1) continue
        const name = baseName(title)
        if (name === '' || name.indexOf('.') === -1) continue
        const icon = chip.querySelector('svg')
        if (icon === null || !isMonochromeSvg(icon)) continue
        trackedExtras.add(icon)
        paintIcon(icon, 'tab:' + name, name, false, false, requestPass)
      }
    }

    function pruneTrackedExtras() {
      for (const element of trackedExtras) {
        if (!element.isConnected) trackedExtras.delete(element)
      }
    }

    function revertExtras() {
      for (const element of [...trackedExtras]) {
        revertIcon(element)
        trackedExtras.delete(element)
      }
    }

    function revertAll() {
      trackedExtras.clear()
      for (const element of document.querySelectorAll('[data-dsh-mi]')) revertIcon(element)
    }

    // -----------------------------------------------------------------------
    // Stylesheets
    // -----------------------------------------------------------------------

    const BASE_CSS = [
      '[data-dsh-mi]{background-repeat:no-repeat;background-position:center;background-size:16px 16px}',
      '[data-dsh-mi]>*{display:none!important}',
      '.dmi-feature-row{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l3)}',
      '.dmi-feature-row:last-child{border-bottom:0}',
      '.dmi-feature-copy{display:flex;flex-direction:column;gap:3px;min-width:0}',
      '.dmi-feature-label{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:18px}',
      '.dmi-feature-description{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}',
      '.dmi-feature-note{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;padding:8px 0;margin:0}',
      '.dmi-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}',
      '.dmi-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}',
      '.dmi-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}',
      '.dmi-switch-thumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb);transition:transform .12s ease}',
      '.dmi-switch[aria-checked="true"] .dmi-switch-thumb{transform:translate(16px);background:var(--dsw-alias-label-primary-foreground)}',
      '.dmi-settings{display:flex;flex-direction:column;padding:2px 0}',
    ].join('\n')

    function installStyle(name, css) {
      const existing = document.querySelector('style[data-dsh-mi-style="' + name + '"]')
      if (existing !== null) return existing
      const style = document.createElement('style')
      style.setAttribute('data-dsh-mi-style', name)
      style.textContent = css
      ;(document.head === null ? document.documentElement : document.head).appendChild(style)
      return style
    }

    function removeStyle(name) {
      for (const style of document.querySelectorAll('style[data-dsh-mi-style="' + name + '"]')) style.remove()
    }

    // -----------------------------------------------------------------------
    // Settings page (Plugins → this bundle's row → Configure)
    // -----------------------------------------------------------------------

    function Switch({ checked, label, labelId, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          'aria-describedby': labelId,
          className: 'dmi-switch',
          onClick: () => onChange(!checked),
        },
        h('span', { className: 'dmi-switch-thumb' }),
      )
    }

    function SettingsView(props) {
      const t = props.t
      const current = React.useSyncExternalStore(subscribeFeatures, getFeatures, getFeatures)
      if (props.view === 'summary') return t('settings.summary')
      const descriptionId = 'dmi-description-extraIcons'
      return h(
        'div',
        { className: 'dmi-settings' },
        h('p', { className: 'dmi-feature-note' }, t('settings.note.fileTree')),
        h(
          'div',
          { className: 'dmi-feature-row' },
          h(
            'div',
            { className: 'dmi-feature-copy' },
            h('span', { className: 'dmi-feature-label' }, t('settings.extraIcons.label')),
            h('span', { id: descriptionId, className: 'dmi-feature-description' }, t('settings.extraIcons.description')),
          ),
          h(Switch, {
            checked: current.extraIcons,
            label: t('settings.extraIcons.label'),
            labelId: descriptionId,
            onChange: value => setFeature('extraIcons', value),
          }),
        ),
        h('p', { className: 'dmi-feature-note' }, t('settings.note.storage')),
      )
    }

    // -----------------------------------------------------------------------
    // Locale dictionaries (en + zh are required by the locale service)
    // -----------------------------------------------------------------------

    const zh = {
      'settings.summary': 'Material 文件/文件夹图标；文件树图标常开，额外工作区图标可切换。',
      'settings.note.fileTree': '文件树图标始终启用；要完全停用本插件，请在插件页关闭它。',
      'settings.note.storage': '设置保存在当前浏览器，切换立即生效、刷新后保持。',
      'settings.extraIcons.label': '额外工作区图标',
      'settings.extraIcons.description': '工作区分组头、输入框工作区 chip 与文档预览 tab 也使用 Material 图标。',
    }

    const en = {
      'settings.summary': 'Material file and folder icons; Files tree icons are always on, extra workspace icons can be switched.',
      'settings.note.fileTree': 'File tree icons are always on; disable the whole plugin to remove them.',
      'settings.note.storage': 'Settings are stored in this browser and apply immediately; they survive a reload.',
      'settings.extraIcons.label': 'Extra workspace icons',
      'settings.extraIcons.description': 'Use Material icons on workspace headers, the composer workspace chip and document preview tabs.',
    }

    // -----------------------------------------------------------------------
    // Runtime: observer, passes, switch application
    // -----------------------------------------------------------------------

    function createRuntime() {
      let disposed = false
      let frame = 0
      let observer = null
      let unsubscribeStore = null

      const raf = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : callback => window.setTimeout(callback, 16)
      const cancelRaf = typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : id => window.clearTimeout(id)

      function runPass() {
        if (disposed) return
        const current = getFeatures()
        paintTree(requestPass)
        if (current.extraIcons) {
          paintWorkspaceRows(requestPass)
          paintComposerChips(requestPass)
          paintPreviewTabs(requestPass)
        } else {
          revertExtras()
        }
        pruneTrackedExtras()
      }

      function requestPass() {
        if (disposed || frame !== 0) return
        frame = raf(() => {
          frame = 0
          runPass()
        })
      }

      function applyFeatures() {
        if (!getFeatures().extraIcons) revertExtras()
        requestPass()
      }

      return {
        start() {
          installStyle('material-icon-theme:icon', BASE_CSS)
          const root = document.body === null ? document.documentElement : document.body
          observer = new MutationObserver(() => requestPass())
          observer.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-expanded', 'aria-selected', 'data-files-path', 'class'],
          })
          unsubscribeStore = subscribeFeatures(applyFeatures)
          requestPass()

          return () => {
            if (disposed) return
            disposed = true
            if (frame !== 0) {
              cancelRaf(frame)
              frame = 0
            }
            if (observer !== null) {
              observer.disconnect()
              observer = null
            }
            if (unsubscribeStore !== null) {
              unsubscribeStore()
              unsubscribeStore = null
            }
            revertAll()
            revertExtras()
            removeStyle('material-icon-theme:icon')
            probing.clear()
            probeCache.clear()
            urlCache.clear()
          }
        },
      }
    }

    // -----------------------------------------------------------------------
    // Plugin export
    // -----------------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'dsh-material-icon-theme: locale')

      ctx.effect(
        () => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_CONFIG_KEY,
          locale: LOCALE_NS,
        }, SettingsView)),
        'dsh-material-icon-theme: settings row',
      )

      ctx.effect(
        () => createRuntime().start(),
        'dsh-material-icon-theme: icon runtime',
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
