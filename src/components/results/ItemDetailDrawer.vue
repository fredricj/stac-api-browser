<script setup lang="ts">
/**
 * Everything one item has to say.
 *
 * The properties come off the wire in Swedish (`flygar`, `upplosning`), so
 * they get the label map; anything unrecognised keeps its own name rather
 * than being guessed at. The raw JSON is there because this is a developer-
 * adjacent tool and the spec's own vocabulary is sometimes the clearest
 * answer to "why did this item match?".
 */
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { StacAsset, StacItem } from '@/types/stac'
import { thumbnailAsset } from '@/types/stac'
import { labelForProperty } from '@/utils/propertyLabels'
import { formatBytes, formatDate } from '@/utils/format'

const props = defineProps<{
  item: StacItem | null
  selected: boolean
}>()

const emit = defineEmits<{ close: []; toggle: [] }>()

const { t, locale } = useI18n()

const showRaw = ref(false)
const panel = useTemplateRef<HTMLElement>('panel')

/** Whatever had focus before the drawer opened, so closing it can give it back. */
let trigger: HTMLElement | null = null

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keep Tab inside the drawer while it is open.
 *
 * `aria-modal` tells assistive tech to treat the rest of the page as hidden,
 * but it does not stop an actual Tab key from walking into it — a sighted
 * keyboard user would tab straight past the drawer into a list they cannot
 * see underneath it.
 */
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !panel.value) return

  const focusable = Array.from(
    panel.value.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  )
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  if (event.shiftKey) {
    if (active === first || !panel.value.contains(active)) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last || !panel.value.contains(active)) {
    event.preventDefault()
    first.focus()
  }
}

/** Properties that already have their own place in the header. */
const HEADER_PROPERTIES = new Set([
  'datetime',
  'start_datetime',
  'end_datetime',
])

const thumbnail = computed(() =>
  props.item ? (thumbnailAsset(props.item)?.href ?? null) : null,
)

const properties = computed(() => {
  if (!props.item) return []
  return Object.entries(props.item.properties)
    .filter(([name, value]) => !HEADER_PROPERTIES.has(name) && value != null)
    .map(([name, value]) => ({
      name,
      label: labelForProperty(name, locale.value) ?? name,
      value: Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, locale.value))
})

const assets = computed(() => {
  if (!props.item) return []
  return Object.entries(props.item.assets ?? {}).map(([name, asset]) => ({
    name,
    asset: asset as StacAsset,
    /** Data assets sit behind HTTP Basic; the rest are public. */
    locked: asset.roles?.includes('data') ?? false,
    size:
      typeof asset['file:size'] === 'number'
        ? formatBytes(asset['file:size'], locale.value)
        : '',
  }))
})

const acquired = computed(() => {
  if (!props.item) return ''
  return formatDate(
    props.item.properties.datetime ?? props.item.properties.start_datetime,
    locale.value,
  )
})

const rawJson = computed(() =>
  props.item ? JSON.stringify(props.item, null, 2) : '',
)

// Opening the drawer moves focus into it, so a keyboard user is not left
// tabbing through the list behind an overlay they cannot see. Closing it
// gives focus back to whatever opened it — usually a row in the results
// list — rather than dropping focus back to the top of the page.
watch(
  () => props.item,
  (item, previous) => {
    showRaw.value = false
    if (item && !previous) {
      trigger = document.activeElement as HTMLElement | null
      requestAnimationFrame(() => panel.value?.focus())
    } else if (!item && previous) {
      trigger?.focus()
      trigger = null
    }
  },
)
</script>

<template>
  <div v-if="item" class="scrim" @click.self="emit('close')">
    <aside
      ref="panel"
      class="drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="t('detail.label', { id: item.id })"
      tabindex="-1"
      @keydown.esc="emit('close')"
      @keydown="trapFocus"
    >
      <header class="head">
        <div class="titles">
          <h2 class="id">{{ item.id }}</h2>
          <p class="collection">{{ item.collection }}</p>
          <p v-if="acquired" class="acquired">
            {{ t('detail.acquired', { date: acquired }) }}
          </p>
        </div>
        <button
          type="button"
          class="close"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          &times;
        </button>
      </header>

      <div class="body">
        <img
          v-if="thumbnail"
          class="preview"
          :src="thumbnail"
          :alt="t('detail.previewAlt', { id: item.id })"
          loading="lazy"
        />

        <button
          type="button"
          class="select"
          :class="{ 'is-selected': selected }"
          :aria-pressed="selected"
          @click="emit('toggle')"
        >
          {{ selected ? t('detail.deselect') : t('detail.select') }}
        </button>

        <section v-if="properties.length" class="section">
          <h3 class="section-title">{{ t('detail.properties') }}</h3>
          <dl class="props">
            <template v-for="entry in properties" :key="entry.name">
              <dt :title="entry.name">{{ entry.label }}</dt>
              <dd>{{ entry.value }}</dd>
            </template>
          </dl>
        </section>

        <section v-if="assets.length" class="section">
          <h3 class="section-title">{{ t('detail.assets') }}</h3>
          <ul class="assets">
            <li v-for="entry in assets" :key="entry.name" class="asset">
              <span class="asset-head">
                <span class="asset-name">{{
                  entry.asset.title || entry.name
                }}</span>
                <!-- Said here rather than at download time, so nobody plans a
                     bulk job around an asset they cannot fetch. -->
                <span v-if="entry.locked" class="asset-lock">
                  {{ t('detail.needsSignIn') }}
                </span>
              </span>
              <span class="asset-meta">
                <template v-if="entry.asset.type">{{
                  entry.asset.type
                }}</template>
                <template v-if="entry.size"> · {{ entry.size }}</template>
              </span>
              <a
                class="asset-href"
                :href="entry.asset.href"
                target="_blank"
                rel="noopener noreferrer"
                >{{ entry.asset.href }}</a
              >
            </li>
          </ul>
        </section>

        <section class="section">
          <button
            type="button"
            class="raw-toggle"
            :aria-expanded="showRaw"
            @click="showRaw = !showRaw"
          >
            {{ showRaw ? t('detail.hideRaw') : t('detail.showRaw') }}
          </button>
          <pre v-if="showRaw" class="raw">{{ rawJson }}</pre>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgb(0 0 0 / 0.4);
  display: flex;
  justify-content: flex-end;
}

.drawer {
  width: min(30rem, 100vw);
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--c-surface);
  border-left: 1px solid var(--c-border);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-4);
  border-bottom: 1px solid var(--c-border);
}

.titles {
  min-width: 0;
  margin-right: auto;
}

.id {
  font-family: var(--font-mono);
  font-size: var(--fs-lg);
  overflow-wrap: anywhere;
}

.collection,
.acquired {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.close {
  flex: none;
  border: 0;
  background: none;
  font-size: var(--fs-2xl);
  line-height: 1;
  color: var(--c-text-muted);
  cursor: pointer;
  padding: 0 var(--sp-1);
}
.close:hover {
  color: var(--c-text);
}

.body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.preview {
  width: 100%;
  border-radius: var(--r-md);
  border: 1px solid var(--c-border);
  background: var(--c-surface-2);
}

.select {
  align-self: flex-start;
  padding: var(--sp-2) var(--sp-4);
  border: 1px solid var(--c-border-strong);
  border-radius: var(--r-md);
  background: var(--c-surface);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.select:hover {
  background: var(--c-surface-hover);
}
.select.is-selected {
  background: var(--c-success-bg);
  border-color: var(--c-selected-line);
  color: var(--c-success);
  font-weight: 600;
}

.section-title {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-faint);
  margin-bottom: var(--sp-2);
}

.props {
  display: grid;
  grid-template-columns: minmax(6rem, auto) 1fr;
  gap: var(--sp-1) var(--sp-3);
  margin: 0;
  font-size: var(--fs-sm);
}

.props dt {
  color: var(--c-text-muted);
}

.props dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}

.assets {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.asset {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border: 1px solid var(--c-border);
  border-radius: var(--r-sm);
}

.asset-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.asset-name {
  font-size: var(--fs-sm);
  font-weight: 500;
}

.asset-lock {
  font-size: var(--fs-xs);
  color: var(--c-warning);
  background: var(--c-warning-bg);
  padding: 0 var(--sp-1);
  border-radius: var(--r-sm);
}

.asset-meta {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.asset-href {
  font-family: var(--font-mono);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}

.raw-toggle {
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
.raw-toggle:hover {
  text-decoration: underline;
}

.raw {
  margin-top: var(--sp-2);
  padding: var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--c-surface-2);
  font-size: var(--fs-xs);
  overflow-x: auto;
  max-height: 24rem;
}
</style>
