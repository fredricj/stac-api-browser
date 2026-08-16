<script setup lang="ts">
/**
 * What the user has chosen to download.
 *
 * Two things earn their place here. The **size estimate**, because a basket of
 * fifty tiles is thirty gigabytes on this catalog and nobody should discover
 * that at download time. And the **out-of-results count**, because the basket
 * deliberately survives new searches — so "48 selected" over three visible
 * rows is correct, and has to be explained rather than looking like a bug.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSelectionStore } from '@/stores/selectionStore'
import { useAuthStore } from '@/stores/authStore'
import { assetHostOf } from '@/services/auth'
import type { StacApiEntry } from '@/types/registry'
import type { StacItem } from '@/types/stac'
import { itemKey } from '@/types/stac'
import { formatBytes, formatCount } from '@/utils/format'
import CredentialsDialog from '@/components/download/CredentialsDialog.vue'

const props = defineProps<{
  /** The currently loaded results, for the bulk actions to operate on. */
  items: StacItem[]
  /** The active search extent, enabling *select all in this box*. */
  bbox: [number, number, number, number] | null
  /** The catalog, for its asset host, auth type and product page. */
  entry: StacApiEntry | null
}>()

const { t, locale } = useI18n()
const selection = useSelectionStore()
const auth = useAuthStore()

const credentialsDialog =
  useTemplateRef<InstanceType<typeof CredentialsDialog>>('credentialsDialog')

const loadedKeys = computed(() => new Set(props.items.map(itemKey)))

const outOfResults = computed(
  () => selection.outOfResults(loadedKeys.value).length,
)

const sizeLabel = computed(() =>
  formatBytes(selection.size.bytes, locale.value),
)

/** True once the selection is large enough that the tier-3 advice applies. */
const isLarge = computed(() => selection.size.bytes > 50e9)

function confirmClear() {
  if (selection.count === 0) return
  // A basket assembled across several searches is real work; losing it to a
  // stray click would be worse than one extra confirmation.
  if (window.confirm(t('basket.clearConfirm', { count: selection.count }))) {
    selection.clear()
  }
}

/* ---------------- Credentials ---------------- */

/** True when this catalog's assets are behind a sign-in. */
const needsAuth = computed(() => props.entry?.auth === 'basic')

/**
 * The host to scope credentials to.
 *
 * Taken from a real selected asset where possible, since that is the host that
 * will actually be asked for them; the registry's `assetHost` is the fallback
 * for a basket that is still empty.
 */
const assetHost = computed(() => {
  const fromSelection = selection.items.find((item) => item.href)?.href
  return (
    (fromSelection ? assetHostOf(fromSelection) : null) ??
    props.entry?.assetHost ??
    null
  )
})

/** A real asset to verify credentials against, or null if nothing is selected. */
const sampleAssetUrl = computed(
  () => selection.items.find((item) => item.href)?.href ?? null,
)

const signedInAs = computed(() => auth.usernameFor(assetHost.value))
const remembered = computed(() => auth.scopeFor(assetHost.value) === 'session')

function signOut() {
  if (assetHost.value) auth.clear(assetHost.value)
}
</script>

<template>
  <section class="basket" :aria-label="t('basket.label')">
    <header class="head">
      <h2 class="title">{{ t('basket.title') }}</h2>
      <span class="count">
        {{ t('basket.count', { count: formatCount(selection.count, locale) }) }}
      </span>
    </header>

    <p v-if="selection.isEmpty" class="empty">{{ t('basket.empty') }}</p>

    <template v-else>
      <p class="size">
        <span class="size-value">{{ sizeLabel }}</span>
        <!-- Labelled plainly when any of it was inferred, so the number is
             never mistaken for a promise. -->
        <span v-if="selection.size.estimated" class="estimated">
          {{ t('basket.estimated', { count: selection.size.unknownCount }) }}
        </span>
      </p>

      <p v-if="isLarge" class="advice">{{ t('basket.veryLarge') }}</p>

      <p v-if="outOfResults > 0" class="elsewhere">
        {{
          t('basket.outOfResults', {
            count: outOfResults,
            total: selection.count,
          })
        }}
      </p>
    </template>

    <div class="actions" role="group" :aria-label="t('basket.bulkLabel')">
      <button
        type="button"
        class="link"
        :disabled="items.length === 0"
        @click="selection.selectAll(items)"
      >
        {{ t('basket.selectAll', { count: items.length }) }}
      </button>

      <button
        v-if="bbox"
        type="button"
        class="link"
        :disabled="items.length === 0"
        @click="selection.selectInBbox(items, bbox)"
      >
        {{ t('basket.selectInBox') }}
      </button>

      <button
        type="button"
        class="link"
        :disabled="items.length === 0"
        @click="selection.invert(items)"
      >
        {{ t('basket.invert') }}
      </button>

      <button
        type="button"
        class="link link--danger"
        :disabled="selection.isEmpty"
        @click="confirmClear"
      >
        {{ t('basket.clear') }}
      </button>
    </div>

    <!-- Sign-in lives here because this is where downloading starts. Browsing,
         searching and previews never reach it: nothing above this line has
         asked the user for anything. -->
    <div v-if="needsAuth && assetHost" class="auth">
      <template v-if="signedInAs">
        <p class="auth-state">
          <span class="auth-ok">{{
            t('auth.signedInAs', { username: signedInAs })
          }}</span>
          <span class="auth-scope">
            {{ remembered ? t('auth.scopeSession') : t('auth.scopeMemory') }}
          </span>
        </p>
        <div class="auth-actions">
          <button type="button" class="link" @click="credentialsDialog?.open()">
            {{ t('auth.change') }}
          </button>
          <button type="button" class="link link--danger" @click="signOut">
            {{ t('auth.signOut') }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="auth-state">{{ t('auth.needed', { host: assetHost }) }}</p>
        <button type="button" class="link" @click="credentialsDialog?.open()">
          {{ t('auth.signIn') }}
        </button>
      </template>

      <CredentialsDialog
        ref="credentialsDialog"
        :host="assetHost"
        :sample-asset-url="sampleAssetUrl"
        :docs-url="entry?.docsUrl"
      />
    </div>
  </section>
</template>

<style scoped>
.basket {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--c-border);
  border-radius: var(--r-lg);
  background: var(--c-surface);
}

.head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
}

.title {
  font-size: var(--fs-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--c-text-faint);
  margin-right: auto;
}

.count {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--c-text);
  font-variant-numeric: tabular-nums;
}

.empty {
  font-size: var(--fs-xs);
  color: var(--c-text-faint);
}

.size {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

.size-value {
  font-size: var(--fs-lg);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.estimated {
  font-size: var(--fs-xs);
  color: var(--c-warning);
}

.advice {
  font-size: var(--fs-xs);
  color: var(--c-warning);
  background: var(--c-warning-bg);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
}

.elsewhere {
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin-top: var(--sp-1);
}

.link {
  border: 0;
  background: none;
  padding: 0;
  font-size: var(--fs-xs);
  color: var(--c-accent);
  cursor: pointer;
}
.link:hover:not(:disabled) {
  text-decoration: underline;
}
.link:disabled {
  color: var(--c-text-faint);
  cursor: not-allowed;
}

.link--danger {
  color: var(--c-danger);
}

.auth {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--c-border);
}

.auth-state {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  color: var(--c-text-muted);
}

.auth-ok {
  color: var(--c-success);
  font-weight: 600;
}

.auth-scope {
  color: var(--c-text-faint);
}

.auth-actions {
  display: flex;
  gap: var(--sp-3);
}
</style>
